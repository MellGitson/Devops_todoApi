# Todo API

API de gestion de tâches, projet fil rouge du cours DevOps / Docker / GitLab CI.

## Ce que fait le projet

Une API REST qui expose un CRUD de tâches. Chaque tâche porte un `id`, une
`description`, un `status`, et ses dates de création et de mise à jour.

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/tasks` | créer une tâche |
| GET | `/api/tasks` | lister toutes les tâches |
| GET | `/api/tasks/:id` | voir une tâche |
| PUT | `/api/tasks/:id` | modifier une tâche |
| DELETE | `/api/tasks/:id` | supprimer une tâche |
| GET | `/health` | vérifier que le serveur répond |

## Lancer le projet

### En local, sans Docker

```bash
npm install
npm start
# http://localhost:3000/health
```

### Avec Docker Compose (recommandé)

```bash
cp .env.example .env      # puis remplir DB_PASSWORD et REGISTRY_USER
docker compose up -d
```

Quatre services démarrent : l'API, PostgreSQL, le service de statistiques
Python et Adminer.

| Service | URL | Rôle |
|---|---|---|
| api | http://localhost:3000 | l'API de tâches |
| stats-api | http://localhost:8000/stats | compteurs par état |
| adminer | http://localhost:8080 | administration de la base |
| db | *non publié* | joignable uniquement depuis le network |

Pour se connecter via Adminer : serveur `db`, et les valeurs `DB_USER`,
`DB_PASSWORD`, `DB_NAME` du `.env`.

```bash
docker compose logs -f      # suivre les logs
docker compose ps           # etat des services
docker compose down         # arreter (les donnees survivent)
docker compose down -v      # arreter ET supprimer les donnees
```

### Depuis les images publiées, sans code source

```bash
# seuls docker-compose.prod.yml et .env sont necessaires
docker compose -f docker-compose.prod.yml up -d
```

## Configuration

Toute la configuration passe par des variables d'environnement. Le `.env` n'est
jamais commité ; `.env.example` sert de modèle.

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | port d'écoute de l'API |
| `NODE_ENV` | — | `production` en conteneur |
| `DB_HOST` | — | nom du service Postgres sur le network |
| `DB_PORT` | `5432` | port de la base |
| `DB_NAME` | — | nom de la base |
| `DB_USER` | — | utilisateur de la base |
| `DB_PASSWORD` | — | mot de passe, **obligatoire** |
| `ADMINER_PORT` | `8080` | port publié pour Adminer |
| `STATS_PORT` | `8000` | port publié pour stats-api |
| `REGISTRY_USER` | — | pseudo du registry (compose de prod) |
| `IMAGE_TAG` | `1.0.0` | version d'image à déployer |

`DB_HOST`, `DB_NAME`, `DB_USER` et `DB_PASSWORD` sont obligatoires : si l'une
manque, l'API refuse de démarrer avec un message explicite plutôt que de
laisser un `undefined` casser plus loin.

## Journal de bord

Chaque étape est validée par un test qui la met en échec avant de la valider :
c'est plus lent que de faire confiance au code, mais c'est la seule façon de
savoir qu'une garantie tient vraiment.

### Le socle : la Todo API

Trois scénarios suffisent à couvrir le CRUD : le chemin heureux (créer une
tâche, la relire par son `id`), l'absence (`id` inexistant → `404`) et l'abus
(une `description` de 50 000 caractères → `400`, sans que le process ne
plante). Les trois passent.

Le point notable est que la validation applicative seule ne protège pas :
Express désérialise le corps de la requête *avant* d'atteindre le code de
validation. Une limite de taille sur `description` (1000 caractères) ne sert
à rien si `express.json()` accepte déjà un corps de plusieurs mégaoctets en
mémoire. Il faut les deux : une limite de parsing en amont (`limit: '100kb'`)
et une limite métier en aval.

### Chapitre 5 : construire une image qui s'arrête correctement

| Mesure | Valeur |
|---|---|
| Taille de l'image | 243 Mo |
| Couches non vides | 8 |
| Build à froid (`--no-cache`) | 5,1 s |
| Build à chaud | 1,1 s (couches CACHED) |
| 1re réponse HTTP 200 | 863 ms |

L'image tourne en utilisateur `node` (jamais `root`), et son contenu se
limite à `node_modules`, `package.json`, `package-lock.json` et `src` — rien
du dépôt Git, rien du `.env`, aucun log ne traverse le build grâce au
`.dockerignore`.

Le point qui a demandé une vraie correction : `docker stop` renvoyait un
**exit code 137**. Ce code signale un SIGKILL, pas un arrêt volontaire. La
cause n'était pas dans le Dockerfile mais dans Node lui-même : un process qui
devient PID 1 dans un conteneur ne bénéficie plus des gestionnaires de
signaux par défaut du noyau. `CMD ["node", "src/server.js"]` en forme exec
est nécessaire (pour que Node reçoive directement le signal, sans passer par
un sous-shell), mais insuffisant tant qu'aucun code applicatif n'écoute
`SIGTERM`. La correction a consisté à fermer le serveur HTTP proprement dans
un handler dédié — après quoi `docker stop` redescend à exit code 0.

### Chapitre 6 : Postgres à la main, pour comprendre ce que Compose automatisera

L'objectif de ce chapitre n'était pas de retenir les commandes, mais de sentir
la douleur qu'elles représentent une fois répétées :

```bash
docker volume create todo_pgdata
docker run -d --name todo-postgres \
  -e POSTGRES_DB=todo_db \
  -e POSTGRES_USER=todo_user \
  -e POSTGRES_PASSWORD=todo_pass \
  -v todo_pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

Sans network dédié, l'API doit connaître l'IP interne du conteneur Postgres
sur le bridge par défaut (ici `172.17.0.2`) — une adresse qui n'a aucune
raison de rester stable d'un redémarrage à l'autre. Passer par un
`docker network create todo-network` et référencer Postgres par son nom de
conteneur (`DB_HOST=todo-postgres`) supprime cette fragilité : Docker résout
le nom via son DNS interne, et plus aucun port n'a besoin d'être publié sur
l'hôte.

La persistance du volume a été vérifiée à deux niveaux de sévérité croissante
: une tâche créée survit à un simple `stop`/`start`, mais aussi à la
suppression complète du conteneur (`docker rm -f`) suivie d'un `docker run`
neuf sur le même volume nommé — le volume, pas le conteneur, est la seule
unité de persistance qui compte.

**Un faux positif a failli valider une isolation qui n'existait pas.** Un
`curl localhost:5432` répondait alors que Postgres ne publiait aucun port.
Un service Postgres tournant nativement sur la machine occupait déjà ce port
— rien à voir avec le conteneur. `netstat` ou un simple test de connexion ne
suffisent donc pas à prouver une isolation réseau ; il faut vérifier
*l'identité* du répondant, pas seulement sa présence. Trois vérifications
combinées ont permis de trancher : `docker port todo-postgres` ne liste
aucun port publié, une tentative d'authentification `todo_user` sur le 5432
de l'hôte est rejetée (ce n'est donc pas la même base), et un conteneur
extérieur au network ne résout même pas le nom `todo-postgres`.

**Comportement en panne.** Couper Postgres pendant que l'API tourne ne fait
pas tomber le process Node : chaque requête échoue proprement en `500`, et
`/health` continue de répondre. La reprise est automatique dès que Postgres
revient, sans redémarrer l'API. Ce comportement n'est pas gratuit : sans un
`pool.on('error')` explicite sur le pool `pg`, une erreur émise par un client
inactif du pool remonte comme exception non interceptée et tue le process.

### Chapitre 7 : orchestrer sans perdre les acquis du chapitre 6

`docker compose up -d` remplace la séquence manuelle par un seul fichier
déclaratif, avec un ordre de démarrage garanti par `depends_on` couplé à un
`healthcheck` : l'API n'essaie de se connecter qu'une fois Postgres passé
`healthy`, ce qui évite la course au démarrage.

**Le piège le plus coûteux à diagnostiquer** ne vient pas de Compose mais du
comportement de l'image officielle `postgres` : `POSTGRES_PASSWORD` n'est lu
qu'à l'initialisation d'un répertoire de données vide. Un volume déjà
initialisé au chapitre précédent ignore silencieusement toute nouvelle valeur
placée dans le `.env` — la base continue de répondre avec son ancien mot de
passe, et l'API échoue en boucle sur `password authentication failed`. Deux
sorties existent : repartir d'un volume neuf en acceptant de perdre les
données, ou aligner manuellement le mot de passe en base via
`ALTER USER ... WITH PASSWORD ...`. Le symptôme est aggravé par
`restart: unless-stopped`, qui masque l'échec derrière une boucle de
redémarrages silencieuse — sans consulter les logs, tout ce qu'on observe est
un conteneur qui semble « ne pas marcher ».

Retirer `DB_PASSWORD` du `.env` produit une dégradation en deux temps :
Compose avertit d'abord que la variable est absente et retombe sur une
chaîne vide, puis l'API refuse explicitement de démarrer
(`Variables d'environnement manquantes : DB_PASSWORD`) plutôt que de tenter
une connexion vouée à l'échec. Postgres, lui, démarre quand même `healthy` —
son volume est déjà initialisé, il n'a plus besoin de cette variable pour
fonctionner.

### Chapitre 8 : un second service qui lit la même base sans jamais y écrire

`stats-api` n'a demandé aucune adaptation du schéma existant : la table
`tasks` et sa colonne `status`, définies dès le chapitre 6, ainsi que le jeu
de variables `DB_*` déjà standardisé, sont directement réutilisables — signe
que nommer les choses correctement tôt évite de la traduction plus tard.

Trois comportements ont été vérifiés :

- **Nominal** — `/stats` agrège les tâches par statut
  (`{"todo":1,"in_progress":1,"done":2}` sur le jeu de test), cohérent avec un
  `COUNT(*) GROUP BY status` exécuté à la main.
- **Cas limite** — un statut sans aucune ligne en base doit apparaître à `0`,
  pas disparaître de la réponse : la liste `KNOWN_STATUSES` est pré-remplie
  avant l'agrégation pour garantir des clés stables, quel que soit l'état des
  données.
- **Panne** — base injoignable, `/stats` répond `503` avec un message
  explicite plutôt qu'une trace Python brute, et le service reste `running`
  puisqu'il ne dépend de Postgres qu'au moment de la requête, jamais au
  démarrage.

### Chapitre 9 : découpler le déploiement du code source

Les images sont publiées sous `mellgitson/todo-api:1.0.0` et
`mellgitson/stats-api:1.0.0`. Le fichier `docker-compose.prod.yml` ne
contient aucune clé `build` : chaque service référence une image via
`${REGISTRY_USER}/...:${IMAGE_TAG}`, ce qui rend le déploiement possible sans
jamais cloner le dépôt.

Adminer reste accessible mais n'est plus démarré par défaut — il vit derrière
`profiles: ["dev"]`, activable via `--profile dev`. Une interface
d'administration de base de données exposée par défaut en production est un
risque qui n'a pas de contrepartie utile.

La validation a consisté à supprimer les images locales puis relancer
`docker compose -f docker-compose.prod.yml up -d` : les deux images sont
retéléchargées depuis le registry, les services démarrent sans aucun fichier
source du projet présent sur la machine, et Adminer ne se lance qu'à la
demande explicite du profil `dev`.

### Chapitre 10 : où va le poids d'une image, et jusqu'où vaut-il la peine de le réduire

| Image | Taille | Couches (poids max) | Build froid / chaud | Temps 1re réponse HTTP |
|---|---|---|---|---|
| todo-api | 243 Mo | 8 (158 Mo) | 5 116 ms / 1 067 ms | 863 ms |
| stats-api | 284 Mo | 8 (87,4 Mo) | 18 596 ms / 1 428 ms | 1 664 ms |

Le gain du cache Docker vient uniquement de l'ordre des instructions : copier
`package.json`/`requirements.txt` avant le reste du code fait que l'étape
d'installation des dépendances (`npm ci`, `pip install`) reste en cache tant
que ces fichiers de verrouillage ne changent pas — même si le code applicatif,
lui, change à chaque commit.

Décomposer la taille finale montre que l'essentiel n'est pas négociable :

| Image | Base | Base seule | Ajouté par le projet |
|---|---|---|---|
| todo-api | `node:22-alpine` | 232 Mo | ~11 Mo |
| stats-api | `python:3.12-slim` | 179 Mo | ~105 Mo |

Sur todo-api en particulier, le code applicatif ne pèse qu'une dizaine de Mo :
aucune réécriture du Dockerfile ne fera franchir un seuil de 150 Mo tant que
la base fait 232 Mo à elle seule. Comparer les variantes de base le confirme :

| Base | Taille |
|---|---|
| `node:18-alpine` | 181 Mo |
| `node:20-alpine` | 193 Mo |
| `node:22-alpine` | 232 Mo |
| `node:24-alpine` | 231 Mo |

Revenir à `node:18-alpine` récupérerait environ 50 Mo, mais cette version est
en fin de vie et ne reçoit plus de correctifs de sécurité : le gain de poids
se paierait en dette de sécurité non maîtrisée, ce qui n'est pas un
arbitrage acceptable pour une image censée tourner en production. La seule
option qui atteindrait réellement 150 Mo est une base `distroless`, mais elle
retire le shell — donc toute possibilité de `docker exec` de diagnostic ou de
vérification en `sh -c whoami`. Le choix retenu ici privilégie une image
qu'on peut inspecter en cas d'incident plutôt qu'un gain de quelques dizaines
de Mo.

Le multi-stage build, souvent présenté comme une optimisation par défaut,
n'apporte ici rien de mesurable : ni todo-api ni stats-api ne compilent quoi
que ce soit, il n'y a donc aucun artefact de build intermédiaire à exclure de
l'image finale.

Rapporté à une pipeline CI, un build à froid complet des deux images coûte
environ 23,7 s (5,1 s + 18,6 s), contre 2,5 s avec un cache chaud préservé
entre les runs — un facteur proche de 10. Cet écart ne se limite pas à ce
projet : il grandit mécaniquement avec chaque dépendance supplémentaire
ajoutée aux deux services.
