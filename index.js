#! /usr/bin/env node

// load config
var path    = require('path')
var ssbKeys = require('ssb-keys')
var config  = require('ssb-config/inject')(process.env.ssb_appname)
config.keys = ssbKeys.loadOrCreateSync(path.join(config.path, 'secret'))
if(config.keys.curve === 'k256')
  throw new Error('k256 curves are no longer supported,'+
                  'please delete' + path.join(config.path, 'secret'))

// validate the config
var configOracle = require('./config')(config)
if (configOracle.hasError()) {
  if (configOracle.allowUnsafe())
    console.log('\nIgnoring unsafe configuration due to --unsafe flag.')
  else {
    console.log('\nAborted due to unsafe config. Run again with --unsafe to override.')
    return
  }
}

logLicense() // per the GPL's recommendation, let ppl know the license

console.log('Starting...')

// start sbot
var sbot = require('scuttlebot')
  .use(require('scuttlebot/plugins/master'))
  .use(require('scuttlebot/plugins/gossip'))
  .use(require('scuttlebot/plugins/friends'))
  .use(require('scuttlebot/plugins/replicate'))
  .use(require('scuttlebot/plugins/blobs'))
  .use(require('scuttlebot/plugins/invite'))
  .use(require('scuttlebot/plugins/block'))
  .use(require('scuttlebot/plugins/logging'))
  .use(require('scuttlebot/plugins/private'))
  .use(require('scuttlebot/plugins/local'))
  .use(require('./api'))
  (config)

// write manifest file
var fs = require('fs')
fs.writeFileSync(
  path.join(config.path, 'manifest.json'),
  JSON.stringify(sbot.getManifest(), null, 2)
)

// setup server
var http = require('http')
var https = require('https')
var ws = require('pull-ws-server')
var httpStack = require('./http-server')
var httpServerFn = httpStack.AppStack(sbot, { uiPath: path.join(__dirname, 'ui') }, configOracle)
var wsServerFn = require('./ws-server')(sbot)

var serverOpts = configOracle.useTLS() ? configOracle.getTLS() : {}
serverOpts.verifyClient = require('./ws-server').verifyClient(configOracle)
var server = ws.createServer(serverOpts)
server.on('error', fatalError)
server.on('connection', wsServerFn)
server.on('request', httpServerFn)
server.listen(configOracle.getPort())
console.log('Serving at', configOracle.getLocalUrl())

// basic error handling
function fatalError (e) {
  if (e.code === 'EADDRINUSE')
    console.error('\nError: port '+e.port+' isn\'t available. Is Patchwork already running?\n')
  else
    console.error(e.stack || e.toString())
  process.exit(1)
}
process.on('uncaughtException', fatalError)

// run electron-specific code, if appropriate
if (process.versions['electron']) {
  require('./electron')(configOracle)
}

function logLicense () {
  console.log('Patchwork - Copyright (C) 2015-2016 Secure Scuttlebutt Consortium')
  console.log('This program comes with ABSOLUTELY NO WARRANTY.')
  console.log('This is free software, and you are welcome to redistribute it under certain conditions (GPL-3.0).')
  console.log('')
}
