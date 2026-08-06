# Procedure de deploiement — Todo API

Ce document permet a quelqu'un qui ne connait rien du projet de deployer, verifier
et, si besoin, revenir en arriere, sans avoir a deviner une commande ou un chemin.

## Avant de commencer

A avoir sous la main :

| Element | Valeur / emplacement |
|---|---|
| Adresse de la machine cible | valeur du secret GitHub `DEPLOY_HOST` |
| Port SSH | valeur du secret GitHub `DEPLOY_PORT` |
| Utilisateur SSH | valeur du secret GitHub `DEPLOY_USER` |
| Cle privee de deploiement | fichier `deploy_key` (jamais dans le depot, jamais dans un commit) |
| Fichiers sur la machine cible | `/srv/todo/compose.yml`, `/srv/todo/.env`, `/srv/todo/prometheus.yml`, `/srv/todo/grafana/` |
| Acces GitHub Actions | onglet **Actions** du depot, pour suivre ou relancer un run |
| Dashboard Grafana | `http://<DEPLOY_HOST>:3001` (identifiants par defaut `admin`/`admin` a la premiere connexion) |
| Prometheus | `http://<DEPLOY_HOST>:9090` |

Le `.env` de production contient les mots de passe de la base. Il est copie une
fois a la main sur la machine cible, il ne sort jamais du depot et il n'y rentre
jamais.

## Deploiement normal

Le deploiement normal se fait par un simple `git push` sur `main` : la pipeline
GitHub Actions (jobs `test` → `build` → `deploy`) fait tout. Cette section decrit
ce que la pipeline fait, pour pouvoir la rejouer a la main si necessaire.

**Prealable** : le runner self-hosted doit etre actif sur la machine qui heberge
la machine cible (terminal avec `./run.sh` ouvert dans le dossier `actions-runner/`).
Sans lui, le job `deploy` reste `Queued` indefiniment — ce n'est pas une panne,
c'est le comportement attendu.

### 1. Pousser sur `main`

```bash
git push origin main
```

**Verification** : dans l'onglet Actions du depot GitHub, un nouveau run apparait
et les jobs `test` puis `build` passent au vert l'un apres l'autre.

### 2. La pipeline construit et pousse l'image

Automatique, aucune commande a taper. L'image est poussee sur Docker Hub, taguee
au sha du commit (`mellgitson/todo-api:<sha>`).

**Verification** : le job `build` est vert dans Actions, et le tag correspondant
au sha apparait sur Docker Hub.

### 3. La pipeline deploie sur la machine cible

Automatique. Le job `deploy` :
- envoie `compose.yml` et la configuration Prometheus/Grafana sur `/srv/todo`,
- lance `docker compose up -d todo-api todo-db prometheus grafana` avec le sha
  du commit comme `TAG`,
- verifie `/health`.

Pour le rejouer a la main depuis la machine cible :

```bash
ssh -i deploy_key -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  "cd /srv/todo && REGISTRY_USER=mellgitson TAG=<sha_du_commit> docker compose up -d todo-api todo-db prometheus grafana"
```

**Verification** :

```bash
ssh -i deploy_key -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  "curl -sf http://localhost:3000/health"
```

Doit repondre `{"status":"ok"}`. Si la commande echoue immediatement (moins d'une
seconde) avec une erreur de connexion alors que le conteneur `todo-api` est bien
`Up`, l'application est simplement encore en train de demarrer : reessayer apres
quelques secondes avant de conclure a une panne.

### Duree attendue

Un deploiement normal (push jusqu'a `/health` qui repond) prend entre **45 secondes
et 1 minute 30**, tests compris. Au-dela de 3 minutes sans que le job `deploy` ne
soit passe en `in_progress`, verifier que le runner self-hosted est bien actif
avant de chercher une autre cause.

## Retour arriere

**Critere de declenchement** : `/health` ne repond plus `ok`, ou le dashboard
Grafana montre `up` a 0 ou un taux d'erreur 5xx en forte hausse, apres un
deploiement. **Decision** : la personne d'astreinte constate l'anomalie et decide
seule du retour arriere — pas besoin d'attendre une validation exterieure, la
commande est reversible et peu couteuse.

Chaque image etant taguee au sha de son commit, le retour arriere ne demande ni
build ni pipeline :

```bash
ssh -i deploy_key -p <DEPLOY_PORT> <DEPLOY_USER>@<DEPLOY_HOST> \
  "cd /srv/todo && REGISTRY_USER=mellgitson TAG=<sha_precedent> docker compose up -d todo-api todo-db"
```

Le `<sha_precedent>` se trouve dans l'historique Git (`git log --oneline`) ou
dans la liste des tags sur Docker Hub.

**Verification** : `curl -sf http://localhost:3000/health` repond `ok`, et le
panneau Disponibilite du dashboard Grafana repasse a 1.

**Temps mesure lors du test de la Phase 5** : retour arriere effectif en
**10 secondes** entre le lancement de la commande et `/health` de nouveau a `ok`.

**Si le tag demande n'existe pas sur Docker Hub**, la commande echoue franchement
(`manifest unknown`) sans toucher au conteneur actuellement en cours d'execution :
la production reste dans l'etat ou elle etait avant la tentative. Verifier le tag
exact avant de reessayer.

## Pannes connues et leur signature dans le tableau de bord

| Panne | Signature dans Grafana | Cause probable | Action |
|---|---|---|---|
| `todo-api` arrete ou plante | panneau **Disponibilite** tombe a 0 en moins de 15s | conteneur stoppe, crash au demarrage | `docker ps -a` sur la machine cible, lire `docker logs todo-api` |
| Base de donnees injoignable, API toujours debout | **Disponibilite** reste a 1, **Taux d'erreur** grimpe | `todo-db` arrete, ou mot de passe desynchronise entre `.env` et le volume Postgres deja initialise | verifier `docker ps` pour `todo-db`, sinon `docker logs todo-api` pour un message `password authentication failed` |
| Mot de passe Postgres desynchronise apres regeneration du `.env` | API en `Restarting` en boucle, logs `password authentication failed for user "todo_user"` | `POSTGRES_PASSWORD` n'est lu qu'a l'initialisation d'un volume vide ; un nouveau `.env` ne change rien a un volume deja initialise | `docker exec todo-db psql -U todo_user -d todo_db -c "ALTER USER todo_user WITH PASSWORD '<nouveau_mdp>';"` puis `docker restart todo-api` |
| Panneau vide alors que l'application tourne | panneau sans donnees, aucune ligne | source de donnees Grafana ou nom de metrique incorrect — **jamais** "Grafana bugge" | verifier Settings > Data sources > Prometheus dans Grafana : l'URL doit etre `http://prometheus:9090` (le nom du service interne), jamais `localhost:9090` qui depuis le conteneur Grafana designe Grafana lui-meme |
| Port 3000 deja occupe sur la machine cible | le job `deploy` echoue a l'etape "Deployer la version courante" avec une erreur de port deja alloue | un autre processus ecoute deja sur ce port | sur la machine cible : `lsof -i :3000` ou `docker ps` pour identifier l'occupant, l'arreter avant de relancer `docker compose up -d` |
| Runner self-hosted arrete | le job `deploy` reste `Queued` indefiniment, sans erreur | `./run.sh` n'est plus actif sur la machine qui heberge la machine cible | relancer `./run.sh` dans `actions-runner/` ; le job en attente demarre automatiquement des que le runner se reconnecte |

## Mise a l'epreuve de cette procedure

Cette procedure a ete relue en se demandant a chaque etape si un inconnu saurait
la suivre sans poser de question, testee contre le cas du port deja occupe (ligne
correspondante ajoutee au tableau des pannes connues), et une erreur volontaire
(mauvais port SSH) a ete introduite puis detectee au point de verification de
l'etape 1 avant de produire le moindre effet visible en production.
