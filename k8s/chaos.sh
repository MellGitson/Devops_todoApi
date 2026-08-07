#!/bin/sh
# Tire une panne au hasard parmi 5 sur todo-api / todo-db dans le namespace todo.
# Le contenu de la panne n'est ecrit qu'en base64 dans .incident : a ne lire
# qu'apres le diagnostic, jamais avant.
set -e

NAMESPACE=todo
INCIDENT_FILE="$(dirname "$0")/.incident"

PANNE=$(( (RANDOM % 5) + 1 ))

case "$PANNE" in
  1)
    DESC="Pod todo-api supprime manuellement (kubectl delete pod)"
    POD=$(kubectl -n "$NAMESPACE" get pods -l app=todo-api -o jsonpath='{.items[0].metadata.name}')
    kubectl -n "$NAMESPACE" delete pod "$POD" > /dev/null
    ;;
  2)
    DESC="Process Node tue dans le conteneur todo-api (kill 1)"
    POD=$(kubectl -n "$NAMESPACE" get pods -l app=todo-api -o jsonpath='{.items[0].metadata.name}')
    kubectl -n "$NAMESPACE" exec "$POD" -- kill 1 > /dev/null 2>&1 || true
    ;;
  3)
    DESC="Tag d'image inexistant sur le Deployment todo-api"
    kubectl -n "$NAMESPACE" set image deployment/todo-api todo-api=mellgitson/todo-api:chaos-tag-inexistant > /dev/null
    ;;
  4)
    DESC="Cle DB_PASSWORD supprimee du Secret todo-secret"
    kubectl -n "$NAMESPACE" patch secret todo-secret --type=json -p='[{"op": "remove", "path": "/data/DB_PASSWORD"}]' > /dev/null
    ;;
  5)
    DESC="Limite memoire du Deployment todo-api abaissee a 8Mi (trop bas)"
    kubectl -n "$NAMESPACE" patch deployment todo-api --type=json \
      -p='[{"op":"add","path":"/spec/template/spec/containers/0/resources","value":{"limits":{"memory":"8Mi"}}}]' > /dev/null
    ;;
esac

echo "$DESC" | base64 > "$INCIDENT_FILE"
echo "Panne injectee. Diagnostiquer avec kubectl avant de lire $INCIDENT_FILE (base64 -d)."
