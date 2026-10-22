#!/usr/bin/env bash
# Only the two Grapsi virtual hosts are changed. Run as root after app rollout.
set -Eeuo pipefail
[[ "${1:-}" == "--apply-grapsi-only" ]] || { echo 'Requires --apply-grapsi-only'; exit 1; }
[[ $(id -u) == 0 ]] || { echo 'Run as root'; exit 1; }
run="/var/backups/grapsi-origin-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$run"
for name in aigrantmentor.com aigrantmentor.online; do
  path="$(readlink -f "/etc/nginx/sites-enabled/$name")"
  [[ "$path" == "/etc/nginx/sites-available/$name" ]] || { echo 'Unexpected virtual-host path'; exit 1; }
  cp -p "$path" "$run/$name"
done
nginx -t
zone=/etc/nginx/conf.d/grapsi-catalogue-protection-zones.conf
[[ ! -f "$zone" ]] || cp -p "$zone" "$run/zones.before"
changed=0
restore_grapsi() {
  local status=$?
  trap - EXIT
  if [[ $status != 0 && $changed == 1 ]]; then
    for name in aigrantmentor.com aigrantmentor.online; do cp -p "$run/$name" "$(readlink -f "/etc/nginx/sites-enabled/$name")"; done
    if [[ -f "$run/zones.before" ]]; then cp -p "$run/zones.before" "$zone"; else rm -f "$zone"; fi
    if nginx -t; then systemctl reload nginx; fi
    echo 'Failed; restored the two Grapsi configurations.' >&2
  fi
  exit "$status"
}
trap restore_grapsi EXIT
changed=1
python3 - "$run" <<'PY'
from pathlib import Path
import sys
run=Path(sys.argv[1])
zone=Path('/etc/nginx/conf.d/grapsi-catalogue-protection-zones.conf')
zone.write_text('limit_req_zone $binary_remote_addr zone=grapsi_catalogue_flood:1m rate=100r/s;\nlimit_conn_zone $binary_remote_addr zone=grapsi_catalogue_connections:1m;\n')
for name in ['aigrantmentor.com','aigrantmentor.online']:
 p=Path('/etc/nginx/sites-enabled',name).resolve()
 s=p.read_text()
 if '# grapsi-private-funding-uploads' not in s:
  import re
  locations='\n    # grapsi-private-funding-uploads\n'+''.join('    location ^~ /uploads/funding-'+kind+'/ { return 404; }\n' for kind in ['documents','templates','intake'])
  s=re.sub(r'(server_name\s+[^;]+;)',lambda m:m.group(1)+locations,s)
 if '# grapsi-catalogue-protection' not in s:
  import re
  s=re.sub(r'(server_name\s+[^;]+;)',r'\1\n    # grapsi-catalogue-protection\n    limit_req zone=grapsi_catalogue_flood burst=200 nodelay;\n    limit_req_status 429;\n    limit_conn grapsi_catalogue_connections 500;\n    limit_conn_status 429;',s)
 s=s.replace('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;','proxy_set_header X-Forwarded-For $remote_addr;')
 s=s.replace('proxy_set_header X-Forwarded-For $remote_addr;', 'proxy_set_header X-Forwarded-For $remote_addr;\n    proxy_set_header Forwarded "";\n    proxy_set_header X-Original-URL "";\n    proxy_set_header X-Rewrite-URL "";') if 'proxy_set_header Forwarded "";' not in s else s
 p.write_text(s)
PY
nginx -t
systemctl reload nginx
changed=0
echo "Grapsi virtual hosts hardened; backups: $run"
