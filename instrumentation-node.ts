// Loaded by instrumentation.ts on the Node.js runtime only. See that file for
// why the per-address connect timeout is raised.
import net from 'net'

if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
  net.setDefaultAutoSelectFamilyAttemptTimeout(1000)
  console.log('[instrumentation] outbound connect attempt timeout set to 1000 ms')
}
