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

### Phase 5 : construire une image qui s'arrête correctement

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

### Phase 6 : Postgres à la main, pour comprendre ce que Compose automatisera

L'objectif de cette phase n'était pas de retenir les commandes, mais de sentir
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

### Phase 7 : orchestrer sans perdre les acquis de la Phase 6

`docker compose up -d` remplace la séquence manuelle par un seul fichier
déclaratif, avec un ordre de démarrage garanti par `depends_on` couplé à un
`healthcheck` : l'API n'essaie de se connecter qu'une fois Postgres passé
`healthy`, ce qui évite la course au démarrage.

**Le piège le plus coûteux à diagnostiquer** ne vient pas de Compose mais du
comportement de l'image officielle `postgres` : `POSTGRES_PASSWORD` n'est lu
qu'à l'initialisation d'un répertoire de données vide. Un volume déjà
initialisé à la phase précédente ignore silencieusement toute nouvelle valeur
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

### Phase 8 : un second service qui lit la même base sans jamais y écrire

`stats-api` n'a demandé aucune adaptation du schéma existant : la table
`tasks` et sa colonne `status`, définies dès la Phase 6, ainsi que le jeu
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

### Phase 9 : découpler le déploiement du code source

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

### Phase 10 : où va le poids d'une image, et jusqu'où vaut-il la peine de le réduire

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

## Mise en production : de l'image au serveur supervisé

Second chantier : faire sortir les images publiées d'une machine de
développement pour les faire tourner, seules, sur une machine cible — avec
une pipeline qui construit, teste et déploie automatiquement, et une
supervision qui dit si le service est vivant sans avoir à s'y connecter.

### Phase 1 : une pipeline qui teste avant de construire

Le workflow GitHub Actions enchaîne trois jobs : `test` (Postgres jetable en
service GitHub-hosted), `build` (image poussée sur Docker Hub, taguée au sha
du commit — jamais `latest`), `deploy`. Chaque job dépend du précédent
(`needs`) : un test qui échoue bloque le build, un build qui échoue bloque le
déploiement. Aucune étape ne peut être sautée par accident.

**Vérifié en conditions d'échec** : retirer le secret Docker Hub fait échouer
le job `build` franchement, sans laisser un déploiement partiel derrière lui.

### Phase 2 : une machine cible qui ressemble à de la vraie production

`vm-prod` est un conteneur Docker-in-Docker avec accès SSH, qui simule une
machine distante sans en avoir le coût : joignable sur `localhost:2222` (SSH),
`localhost:3000` (API). La clé privée SSH (`deploy_key`) ne quitte jamais le
dépôt ; côté GitHub, seule la clé publique correspondante est nécessaire pour
que le job `deploy` s'y connecte.

### Phase 3 : un runner self-hosted, pour que le job `deploy` ait un endroit où s'exécuter

Un runner GitHub Actions tourne en local (`actions-runner/`, lancé via
`./run.sh`) plutôt que sur l'infrastructure GitHub, parce que c'est lui qui a
la route réseau vers `vm-prod`. Sans lui actif, le job `deploy` reste `Queued`
indéfiniment — ce n'est pas une panne à diagnostiquer, c'est le comportement
attendu, documenté pour ne pas être confondu avec un vrai incident.

### Phase 4 : le déploiement lui-même, via SSH

Le job `deploy` envoie `docker-compose.prod.yml` sur la machine cible puis
lance `docker compose up -d` avec le tag d'image du commit courant, avant de
vérifier `/health`. Un test délibéré (mauvais port SSH) a permis de confirmer
que l'échec se produit au bon endroit — dès la connexion, avant toute
tentative de déploiement — plutôt que de laisser la pipeline échouer plus
loin avec un message trompeur.

`curl` sur la machine cible a dû apprendre à réessayer sur les erreurs
réseau transitoires (connexion réinitialisée), pas seulement sur une connexion
refusée : sans ce réglage, une vérification `/health` lancée trop tôt (le
temps que le conteneur finisse de démarrer) faisait échouer le déploiement
alors que l'application allait répondre correctement quelques secondes plus
tard.

### Phase 5 : régresser volontairement pour vérifier que les tests protègent vraiment

Une régression délibérée sur `/health` (renvoyer `500` au lieu de `200`) a été
introduite puis détectée par la suite de tests avant d'atteindre le job
`build` — la preuve que la CI bloque réellement une régression, pas seulement
qu'elle tourne verte quand tout va bien. La régression a ensuite été annulée
dans un commit dédié.

### Phase 6 : instrumenter avant de superviser

`prom-client` expose trois métriques sur `/metrics` : un compteur de requêtes
HTTP (`http_requests_total`, par méthode/route/statut), un histogramme de
latence (`http_request_duration_seconds`) et un compteur métier
(`tasks_created_total`). Le choix déterminant est `route` plutôt que l'URL
brute dans les labels : `/api/tasks/42` et `/api/tasks/57` doivent compter
comme la même route, sinon chaque `id` distinct crée une nouvelle série
temporelle et la cardinalité explose sans plafond.

### Phase 7 : Prometheus et Grafana sur la machine cible

Prometheus scrute `todo-api:3000/metrics` toutes les 5 secondes (le nom du
service Compose, jamais une IP — même raisonnement qu'au chantier précédent
avec `DB_HOST`). Le dashboard Grafana « Todo API - Golden Signals » est
provisionné automatiquement par la pipeline (aucun clic dans l'interface
Grafana), avec quatre panneaux calqués sur les quatre signaux dorés :
Disponibilité (`up`), Trafic (requêtes/s), Erreurs (taux de 5xx), Latence p95.

### Phase 8 et 9 : documenter le retour arrière avant d'en avoir besoin

Le retour arrière ne demande ni build ni pipeline puisque chaque image est
déjà taguée au sha de son commit : rejouer `docker compose up -d` avec
`TAG=<sha_précédent>` suffit. **Mesuré en conditions réelles : 10 secondes**
entre le lancement de la commande et `/health` de nouveau à `ok` — avec une
coupure de service pendant ce laps de temps, le temps que le conteneur
redémarre.

`docs/PROCEDURE_DEPLOIEMENT.md` documente, en plus de ce retour arrière, les
pannes rencontrées et leur signature dans Grafana : un service arrêté fait
tomber le panneau Disponibilité en moins de 15 secondes, une base injoignable
laisse l'API debout mais fait grimper le taux d'erreur, un mot de passe
Postgres désynchronisé après régénération du `.env` se traduit par des
`Restarting` en boucle avec `password authentication failed` dans les logs —
parce que `POSTGRES_PASSWORD` n'est lu qu'à l'initialisation d'un volume vide,
un `.env` régénéré ne change rien à un volume déjà initialisé.

## Du serveur unique au cluster

Troisième chantier : remplacer la machine cible unique par un cluster
Kubernetes local (`todo-cluster`, k3d), namespace `todo`. Objectif : qu'une
machine qui tombe ne coupe plus rien, et qu'un push suffise pour que le
cluster le sache. Les manifestes vivent dans `k8s/` ; la procédure détaillée
(accès kubectl, retour arrière, pannes) est dans
`docs/PROCEDURE_DEPLOIEMENT.md`.

### Phases 1 à 4 : l'application tourne dans le cluster

`todo-api` (Deployment + Service), sa configuration (`ConfigMap` pour
`DB_HOST`/`DB_PORT`/`PORT`, `Secret` pour `DB_NAME`/`DB_USER`/`DB_PASSWORD`),
sa base Postgres (`PersistentVolumeClaim` + Deployment + Service `todo-db`) et
son exposition externe (`Ingress` Traefik sur `todo.localhost`) sont montés un
par un, chacun vérifié avant le suivant :

- **Boucle de réconciliation** : supprimer un pod le fait réapparaître
  automatiquement, sans action manuelle.
- **Persistance** : une tâche créée survit à la suppression du pod Postgres,
  grâce au PVC — c'est le volume, pas le pod, qui porte les données (même
  enseignement qu'au premier chantier Docker, transposé à Kubernetes).
- **Suppression d'un PVC monté** : bloquée en `Terminating` par le finalizer
  `kubernetes.io/pvc-protection` tant qu'un pod vivant l'utilise — elle ne se
  finalise réellement qu'une fois ce pod supprimé.
- **`Ingress`** : `curl -H "Host: todo.localhost" http://localhost:8080/health`
  route correctement vers `todo-api` via le load balancer k3d.

### Phase 5 : un push, et le cluster se met à jour

Le job `deploy` du workflow n'utilise plus SSH : `kubectl set image` suivi de
`kubectl rollout status --timeout=120s`, sur le même runner self-hosted
(qui a déjà accès au kubeconfig du cluster, aucun secret GitHub
supplémentaire). `rollout status` fait échouer le job si le rollout ne
converge pas — testé avec un tag d'image volontairement inexistant, le job
échoue bien plutôt que de rester bloqué silencieusement.

### Phase 6 : trois réplicas, et la preuve que le trafic se répartit

`todo-api` passe à `replicas: 3`. Le script `k8s/charge.sh` génère du trafic
via l'Ingress ; interrogé pod par pod via `port-forward` + `/metrics`, le
compteur `http_requests_total` confirme une répartition équilibrée
(30 / 30 / 33 requêtes sur 93 envoyées).

### Phase 7 : des probes qui peuvent mentir, et c'est documenté

`readinessProbe` et `livenessProbe` interrogent `/health` — qui ne touche
jamais la base de données. Vérifié en coupant volontairement `todo-db`
(`kubectl scale --replicas=0`) : les pods `todo-api` restent `1/1 Ready`,
`/health` continue de répondre `{"status":"ok"}`, mais `/api/tasks` renvoie
`500`. C'est un choix assumé, pas une omission — corriger `/health` pour
qu'il vérifie la base transformerait une panne de base de données isolée en
cascade de redémarrages sur des pods `todo-api` qui, eux, n'ont rien de
cassé. Documenté tel quel dans `docs/PROCEDURE_DEPLOIEMENT.md`, non « corrigé »
sans décision explicite.

### Phase 8 : viser zéro requête perdue pendant un déploiement

`strategy.rollingUpdate` avec `maxSurge: 1` et `maxUnavailable: 0` — jamais
moins de 3 pods disponibles pendant une mise à jour. Mesuré sous charge
continue pendant un rollout réel : quelques requêtes en `502`/`504`
subsistent malgré ce réglage (4 sur 404, puis 3 sur 227 selon les essais,
~1 % du trafic). La cause probable est que le pod sortant reçoit `SIGTERM`
avant que Traefik ait retiré son endpoint de la liste de routage — un
`preStop` avec délai de drain corrigerait ça, mais c'est resté hors du
périmètre demandé pour cette phase et n'a pas été ajouté sans validation
explicite.

| | Hier (SSH manuel) | Aujourd'hui (rolling update k8s) |
|---|---|---|
| Disponibilité pendant un déploiement | coupure le temps du redémarrage du conteneur | quasi continue, ~1 % de requêtes perdues dans nos mesures |

### Phase 9 : annuler un déploiement, chronométré

`kubectl rollout undo` ramène le Deployment à la révision précédente en
**6,7 à 7,1 secondes** (undo simple ou `--to-revision` explicite), sans
coupure de service observée — contre 10 secondes et une coupure complète pour
le retour arrière SSH d'hier. Le cas « rien à annuler » a aussi été vérifié :
demander `--to-revision=<révision déjà active>` échoue franchement
(`unable to find specified revision`), parce qu'une révision redevenue
courante sort de la liste numérotée de `kubectl rollout history`. Effet de
bord découvert en cours de route : un rollout vers un tag d'image absent de
Docker Hub ne coupe rien non plus, grâce au même `maxUnavailable: 0` — les
anciens pods sains continuent de servir le trafic pendant que le nouveau
pod reste bloqué en `ImagePullBackOff`.

| | Hier (SSH) | Aujourd'hui (k8s) |
|---|---|---|
| Temps de retour arrière | 10 s | 6,7 – 7,1 s |
| Disponibilité pendant le retour | coupure | aucune coupure observée |

### Phase 10 : cinq pannes injectées, cinq diagnostics posés avant de lire la réponse

`k8s/chaos.sh` tire une panne au hasard parmi cinq et écrit sa description en
base64 dans un fichier `.incident`, volontairement illisible avant d'avoir
posé un diagnostic par `kubectl`. Les cinq ont été déclenchées et
diagnostiquées :

| Panne | Se répare seule ? | Signature |
|---|---|---|
| Pod supprimé manuellement | Oui, immédiatement | nouveau pod, AGE récent, aucune erreur |
| Limite mémoire trop basse (8Mi) | Non pour le pod fautif, service intact | nouveau pod `OOMKilled`, anciens pods `1/1 Running` |
| Process tué dans le conteneur (`kill 1`) | Oui, très vite | même pod/IP, `RESTARTS` incrémenté, bref `0/1` |
| Clé `DB_PASSWORD` supprimée du Secret | Non — invisible jusqu'au prochain redémarrage | rien dans `kubectl get pods` avant coup ; tout nouveau pod part en `CrashLoopBackOff` |
| Tag d'image inexistant | Non pour le pod fautif, service intact | nouveau pod `ErrImagePull`, anciens pods intacts |

Le fil conducteur des cinq : `maxUnavailable: 0` combiné à la readinessProbe
protège le trafic tant qu'au moins un pod sain existe déjà. La vraie question
à se poser sur chaque panne n'est presque jamais « le service est-il coupé ? »
(rarement) mais « un futur rollout va-t-il converger ? » (pas toujours — le
cas du Secret amputé bloque net tout déploiement futur sans qu'aucun signe
avant-coureur n'apparaisse dans `kubectl get pods`).

### Phase 11 : une seule procédure, jamais deux versions qui divergent

`docs/PROCEDURE_DEPLOIEMENT.md` a été complété, pas dupliqué : la section SSH
d'hier reste en place pour mémoire, une nouvelle section couvre l'accès
kubectl, le déploiement manuel d'urgence, le retour arrière k8s et les cinq
pannes ci-dessus avec leur remède.

### Phase 12 : combien de mémoire faut-il vraiment

`kubectl top pods` (metrics-server natif sur k3d, rien à installer) donne une
consommation réelle de ~17-19 Mo par pod `todo-api` au repos. Quatre valeurs
de `resources.requests`/`limits.memory` ont été essayées, un commit par
valeur :

| Valeur | Résultat |
|---|---|
| 128 Mi | OK, large marge |
| 32 Mi | OK, marge confortable |
| 16 Mi | **OOMKilled** (exit code 137) dès le démarrage, `CrashLoopBackOff` |
| 32 Mi (recul d'un cran) | retenue |

Un rolling update sous charge à 32 Mi a été remesuré pour s'assurer que la
limite mémoire ne dégrade pas le comportement déjà observé en Phase 8 : 443
requêtes servies, 5 en échec (~1,1 %) — le même ordre de grandeur qu'avant
tout réglage de ressources, et aucun `OOMKilled` pendant le test. La limite
retenue absorbe les pics du rolling update sans se déclencher.

### Ce qui reste vrai des deux chantiers de déploiement

Le motif qui traverse SSH et Kubernetes est le même : la disponibilité ne
vient jamais du produit final tout seul, elle vient de la façon dont on
change de version. Un rolling update sur trois pods avec `maxUnavailable: 0`
n'est pas magique — il reste ~1 % de requêtes perdues dans nos mesures — mais
il fait mieux qu'un `docker compose up -d` qui coupe le service le temps d'un
redémarrage, parce qu'il n'y a jamais de moment où *zéro* pod ne répond.
