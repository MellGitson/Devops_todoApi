#!/bin/sh
# Genere du trafic vers l'API pour observer la repartition entre pods.
# Usage : ./charge.sh [nombre_de_requetes] [url]
COUNT="${1:-100}"
URL="${2:-http://localhost:8080/health}"

i=0
while [ "$i" -lt "$COUNT" ]; do
  curl -s -o /dev/null -H "Host: todo.localhost" "$URL"
  i=$((i + 1))
done

echo "Trafic termine : $COUNT requetes envoyees vers $URL"
