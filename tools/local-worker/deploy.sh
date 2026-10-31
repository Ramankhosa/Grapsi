#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 1 ]] || exit 2
archive=/home/raman/broker-package.tgz
expected="$1"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || exit 2
actual="$(sha256sum "$archive" | cut -d' ' -f1)"
[[ "$actual" == "$expected" ]] || { echo "Package integrity check failed"; exit 3; }
release="/opt/grapsi-local-worker/releases/$(printf '%s' "$expected" | cut -c1-16)"
[[ "$release" == /opt/grapsi-local-worker/releases/* ]] || exit 4
install -d -m 0755 "$release"
tar -xzf "$archive" --no-same-owner -C "$release"
chown -R root:root "$release"
find "$release" -type d -exec chmod 0755 {} +
find "$release" -type f -exec chmod 0644 {} +
if [[ ! -e /etc/grapsi-local-worker.json ]]; then
  printf '%s\n' '{"enabled":true,"appRoot":"/var/www/granter/Grapsi","allowedHosts":["anrfonline.in","onlinedst.gov.in"],"allowApprovedSites":true}' > /etc/grapsi-local-worker.json
  chmod 0644 /etc/grapsi-local-worker.json
fi
sudo -n -u ramankhosa /usr/bin/node "$release/install.cjs"
if [[ -e /opt/grapsi-local-worker/current ]]; then
  [[ -L /opt/grapsi-local-worker/current ]] || { echo "Unexpected current deployment path"; exit 5; }
  previous="$(readlink -f /opt/grapsi-local-worker/current)"
  [[ "$previous" == /opt/grapsi-local-worker/releases/* ]] || exit 6
  printf '%s\n' "$previous" > /opt/grapsi-local-worker/previous-release
fi
ln -s "$release" "/opt/grapsi-local-worker/current.$$.tmp"
mv -Tf "/opt/grapsi-local-worker/current.$$.tmp" /opt/grapsi-local-worker/current
install -m 0644 "$release/grapsi-local-analysis-queue.service" /etc/systemd/system/grapsi-local-analysis-queue.service
install -m 0644 "$release/grapsi-local-analysis-queue.timer" /etc/systemd/system/grapsi-local-analysis-queue.timer
systemctl daemon-reload
systemctl enable --now grapsi-local-analysis-queue.timer
systemctl start grapsi-local-analysis-queue.service
systemctl is-active grapsi-source-watch.service
sudo -n -u ramankhosa /usr/bin/node "$release/broker.cjs" --status
printf '%s\n' "LOCAL_WORKER_DEPLOYED $release"
