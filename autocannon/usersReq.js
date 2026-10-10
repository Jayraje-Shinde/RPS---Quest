'use strict'

const http = require('http')
const autocannon = require('/home/scaledb/.nvm/versions/node/v24.21.0/bin/autocannon')

const server = http.createServer(handle)

server.listen(0, startBench)

function handle (req, res) {
  console.log(req.url)
  res.end('hello world')
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function startBench () {
  const url = 'http://localhost:3000'

  autocannon({
    url,
    connections: 1000,
    duration: 10,

    requests: [
      {
        method: 'GET',
        path: '/customers/1000'
      }
    ],

    setupClient: (client) => {
      client.on('request', () => {
        const id = randomInt(1,100000)

        client.setRequest({
	method : 'GET',
	path: `/users/${id}`
})
      })
    }
  }, finishedBench)

  function finishedBench (err, res) {
  if (err) {
    console.error(err)
    return
  }

  console.log(autocannon.printResult(res))
	process.exit()
}
}
