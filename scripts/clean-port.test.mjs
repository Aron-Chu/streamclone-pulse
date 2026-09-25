import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('port inspection refuses an occupied port without stopping its owner', async () => {
  const server = createServer(socket => socket.end())
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = server.address().port
    const child = spawn(process.execPath, [fileURLToPath(new URL('./clean-port.mjs', import.meta.url)), String(port)])
    let output = ''
    child.stderr.on('data', data => { output += data })
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
    assert.equal(code, 1)
    assert.match(output, /No process was stopped/)
    assert.equal(server.listening, true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
