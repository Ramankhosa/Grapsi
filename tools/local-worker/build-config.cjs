const fs=require('node:fs');const P=require('./policy.cjs');
const config={version:P.APP_VERSION,protocol:P.PROTOCOL,model:P.MODEL,policyHash:P.POLICY_HASH,resultSchema:P.RESULT_SCHEMA,
 runtime:{url:'https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-win-cpu-x64.zip',sha256:'37b3efcf962847ca869745fd4ccf7f5e7e8dacfeff9fa3523b4ca8cdc66d632b'},
 production:{project:'awesome-pivot-450611-e6',zone:'asia-south2-b',instance:'patentnest-production-20251121-051811',sshUser:'raman',command:'sudo -n -u ramankhosa /usr/bin/node /opt/grapsi-local-worker/current/broker.cjs --stdio'}};
fs.writeFileSync(process.argv[2],JSON.stringify(config,null,2));
