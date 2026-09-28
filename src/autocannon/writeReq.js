'use strict'

const autocannon = require('/home/scaledb/.nvm/versions/node/v24.21.0/bin/autocannon')

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const url = 'http://localhost:3000'

autocannon({
  url,
  connections: 50,
  duration: 20,

  requests: [
    {
      method: 'POST',
      path: '/customers',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test', email: 'test@test.com', city: 'Pune', country: 'IN' })
    }
  ],

  setupClient: (client) => {
    client.on('request', () => {
      const n = randomInt(1, 1000000)
      client.setRequest({
        method: 'POST',
        path: '/customers',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `test-${n}`,
          email: `test-${n}@test.com`,
          city: 'Pune',
          country: 'IN'
        })
      })
    })
  }
}, finishedBench)

function finishedBench(err, res) {
  if (err) {
    console.error(err)
    return
  }
  console.log(autocannon.printResult(res))
  process.exit()
}
