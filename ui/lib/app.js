'use strict'

/*
Application Master State
========================
Common state which either exists as part of the session,
or which has  been  loaded  from  scuttlebot during page
refresh because  its  commonly  needed during rendering.
*/

// constants
var POLL_PEER_INTERVAL = 5e3 // every 5 seconds

var multicb   = require('multicb')
var pull      = require('pull-stream')
var SSBClient = require('./ws-client')
var emojis    = require('emoji-named-characters')
var Emitter   = require('events')
var extend    = require('xtend/mutable')
var pu        = require('patchkit-util')
var favicon   = require('./favicon')
var createHashHistory = require('history').createHashHistory

// event streams and listeners
var patchworkEventStream = null
var isWatchingNetwork = false

// master state object
var app =
module.exports = extend(new Emitter(), {
  // sbot rpc connection
  ssb: SSBClient(),

  // pull state from sbot, called on every view change
  fetchLatestState: fetchLatestState,

  // ui data
  history: createHashHistory({ queryKey: false }),
  isComposerOpen: false,
  suggestOptions: { 
    ':': Object.keys(emojis).map(function (emoji) {
      return {
        image: './img/emoji/' + emoji + '.png',
        title: emoji,
        subtitle: emoji,
        value: ':' + emoji + ':'
      }
    }),
    '@': []
  },
  issues: [],
  issue: addIssue.bind(null, true), // helper to add an issue
  minorIssue: addIssue.bind(null, false), // helper to add an issue that shouldnt trigger a modal
  notifications: [],
  notice: addNotification,
  dismissNotice: removeNotification,

  // application state, fetched every refresh
  actionItems: {},
  indexCounts: {},
  channels: [], // array of { name: str, pinned: bool, lastUpdated: ts, hasNew: bool }
  user: {
    id: null,
    profile: {},
    needsSetup: false, // does the setup flow need to occur?
    followeds: [], // people the user follows
    friends: [], // people the user follows, who follow the user back
    nonfriendFolloweds: [], // people the user follows, who dont follow the user back
    nonfriendFollowers: [] // people the user doesnt follow, who follows the user
  },
  users: {
    names: {},
    profiles: {}
  },
  peers: [],
  isWifiMode: false
})
app.on('notice', app.notice)

function addIssue (isUrgent, title, err, extraIssueInfo) {
  console.error(title, err, extraIssueInfo)
  var message = err.message || err.toString()
  var stack   = err.stack || ''
  var issueDesc = message + '\n\n' + stack + '\n\n' + (extraIssueInfo||'')

  app.issues.unshift({
    isRead: false,
    isUrgent: isUrgent,
    title: title,
    message: message,
    stack: stack,
    issueUrl: 'https://github.com/ssbc/patchwork/issues/new?body='+encodeURIComponent(issueDesc)
  })
  app.emit('update:issues')
}

var notificationUuidCounter = 0
function addNotification (message) {
  app.notifications.push({ key: ++notificationUuidCounter, message: message, dismissAfter: 5e3 })
  app.emit('update:notifications')
}
function removeNotification (notification) {
  app.notifications = app.notifications.filter(n => n !== notification)
  app.emit('update:notifications')
}

function updateChannels (name, values) {
  // upsert
  var i
  for (i = 0; i < app.channels.length; i++) {
    if (app.channels[i].name === name) {
      // immutable update - create a new object, so shouldUpdate works nicely in the channels list com
      app.channels[i] = Object.assign({}, app.channels[i], values)
      break
    }
  }
  if (i === app.channels.length)
    app.channels.push(Object.assign({ name: name }, values))

  // sort
  sortChannels()
}

function sortChannels () {
  app.channels.sort(function (a, b) {
    // go by last updated
    return b.lastUpdated - a.lastUpdated
  })
}

function onPatchworkEvent (e) {
  if (e.type == 'index-change') {
    for (var k in e.counts)
      app.indexCounts[k] = e.counts[k]
    app.emit('update:indexCounts')
    updateTitle()
    if (e.index.indexOf('channel-') === 0) {
      updateChannels(e.index.slice('channel-'.length), { lastUpdated: Date.now() })
      app.emit('update:channels')      
    }
  }
  else if (e.type == 'isread') {
    app.emit('update:isread', { key: e.key, value: e.value })
  }
}

function pollPeers () {
  app.ssb.gossip.peers(function (err, peers) {
    var isWifiMode = require('./util').getPubStats(peers).hasSyncIssue
    app.peers = peers
    app.emit('update:peers')
    if (isWifiMode !== app.isWifiMode) {
      app.isWifiMode = isWifiMode
      app.emit('update:isWifiMode')
    }
  })
}

function updateTitle () {
  // document.title = '('+app.indexCounts.inboxUnread+') Patchwork'
  favicon.update({ label: app.indexCounts.inboxUnread })
}
window.favicon = favicon

function fetchLatestState (cb) {
  if (!patchworkEventStream)
    pull((patchworkEventStream = app.ssb.patchwork.createEventStream()), pull.drain(onPatchworkEvent.bind(this)))
  if (!isWatchingNetwork) {
    setInterval(pollPeers, POLL_PEER_INTERVAL)
    isWatchingNetwork = true
  }

  var done = multicb({ pluck: 1 })
  app.ssb.whoami(done())
  app.ssb.patchwork.getNamesById(done())
  app.ssb.patchwork.getAllProfiles(done())
  app.ssb.patchwork.getActionItems(done())
  app.ssb.patchwork.getIndexCounts(done())
  app.ssb.gossip.peers(done())
  done(function (err, data) {
    if (err) throw err.message
    app.user.id         = data[0].id
    app.users.names     = data[1]
    app.users.profiles  = data[2]
    app.actionItems     = data[3]
    app.indexCounts     = data[4]
    app.peers           = data[5]
    app.isWifiMode      = require('./util').getPubStats(app.peers).hasSyncIssue
    app.user.profile    = app.users.profiles[app.user.id]
    app.user.needsSetup = !app.users.names[app.user.id]
    updateTitle()

    // get friend list
    var social = require('patchkit-util/social')
    app.user.followeds = social.followeds(app.users, app.user.id)
    app.user.friends = app.user.followeds.filter(function (other) { return other !== app.user.id && social.follows(app.users, other, app.user.id) })
    app.user.nonfriendFolloweds = app.user.followeds.filter(function (other) { return other !== app.user.id && !social.follows(app.users, other, app.user.id) })
    app.user.nonfriendFollowers = social.unfollowedFollowers(app.users, app.user.id, app.user.id)

    // refresh suggest options for usernames
    app.suggestOptions['@'] = []
    if (app.user.profile) {
      for (var id in app.users.profiles) {
        if (id == app.user.profile.id || social.follows(app.users, app.user.id, id)) {
          var name = app.users.names[id]
          app.suggestOptions['@'].push({
            id: id,
            cls: 'user',        
            title: name || id,
            image: pu.getProfilePicUrl(app.users, id),
            subtitle: name || id,
            value: name ? ('@'+name) : id
          })
        }
      }
    }

    app.emit('update:all')
    cb && cb()
  })
}