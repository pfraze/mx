var mlib = require('ssb-msgs')
var u = require('./util')

module.exports = function (sbot, db, state, emit) {

  var processors = {
    post: function (msg) {
      var c = msg.value.content
      var root = mlib.link(c.root, 'msg')
      var recps = mlib.links(c.recps)

      // inbox index:
      // add msgs that address the user
      var inboxRow
      if (u.findLink(recps, sbot.id)) {
        inboxRow = state.inbox.sortedUpsert(msg.received, root ? root.link : msg.key)
        emit('index-change', { index: 'inbox' })
        attachChildIsRead(inboxRow, msg.key)
      }
      // update for replies
      else if (root) {
        inboxRow = state.inbox.sortedUpdate(msg.received, root.link)
        if (inboxRow) {          
          emit('index-change', { index: 'inbox' })
          attachChildIsRead(inboxRow, msg.key)
        }
      }
    },

    chat: function (msg) {
      // chat index: add chats
      var recps = mlib.links(c.recps)
      if (u.findLink(recps, sbot.id)) {
        var indexName = 'chat-'+msg.value.author
        var index = state[indexName] = (state[indexName] || u.index(indexName))
        index.sortedUpsert(msg.ts, msg.key)
        emit('index-change', { index: indexName })
      }
    },

    contact: function (msg) {      
      mlib.links(msg.value.content.contact, 'feed').forEach(function (link) {
        // update profiles
        var toself = link.link === msg.value.author
        if (toself) updateSelfContact(msg.value.author, msg)
        else        updateOtherContact(msg.value.author, link.link, msg)
      })
      if ('following' in msg.value.content) {
        // certs index: add follows
        state.certs.sortedUpsert(msg.received, msg.key)
        emit('index-change', { index: 'certs' })

        // chat index: add follows
        var contact = mlib.link(msg.value.content.contact)
        if (contact && (contact.link == sbot.id || msg.value.author == sbot.id)) {
          var indexName = 'chat-'+((contact.link == sbot.id) ? msg.value.author : contact.link)
          var index = state[indexName] = (state[indexName] || u.index(indexName))
          index.sortedUpsert(ts(msg), msg.key)
          emit('index-change', { index: indexName })
        }
      }
    },

    about: function (msg) {
      // update profiles
      mlib.links(msg.value.content.about, 'feed').forEach(function (link) {
        var toself = link.link === msg.value.author
        if (toself) updateSelfContact(msg.value.author, msg)
        else        updateOtherContact(msg.value.author, link.link, msg)
      })
    },

    vote: function (msg) {
      // notices index: add upvotes on your messages
      var msgLink = mlib.link(msg.value.content.vote, 'msg')
      if (msgLink && state.mymsgs.indexOf(msgLink.link) >= 0 && msgLink.value > 0) {
        state.notices.sortedUpsert(ts(msg), msg.key)
        emit('index-change', { index: 'notices' })
      }

      // user flags
      var voteLink = mlib.link(msg.value.content.vote, 'feed')
      if (voteLink) {
        var target = getProfile(voteLink.link)
        if (voteLink.value < 0)
          target.flaggers[msg.value.author] = { msgKey: msg.key, reason: voteLink.reason }
        else
          delete target.flaggers[msg.value.author]
      }
    }
  }

  function getProfile (pid) {
    if (pid.id) // already a profile?
      return pid

    var profile = state.profiles[pid]
    if (!profile) {
      state.profiles[pid] = profile = {
        id: pid,
        self: { name: null, image: null }, // values set by this user about this user
        byMe: { name: null, image: null }, // values set by the local user about this user
        names: {}, // map of name -> array of users to use that name
        images: {}, // map of images -> array of users to use that pic
        followers: {}, // map of followers -> true
        flaggers: {}, // map of flaggers -> flag-msg
      }
    }
    return profile
  }

  function updateSelfContact (author, msg) {
    var c = msg.value.content
    author = getProfile(author)

    // name: a non-empty string
    if (nonEmptyStr(c.name)) {
      var safeName = makeNameSafe(c.name)

      // remove old assignment, if it exists
      for (var name in author.names) {
        author.names[name] = author.names[name].filter(function (id) { return id !== author.id })
        if (!author.names[name][0])
          delete author.names[name]
      }

      // add new assignment
      author.self.name = safeName
      author.names[safeName] = (author.names[safeName]||[]).concat(author.id)
      rebuildNamesFor(author)
    }

    // image: link to image
    if ('image' in c) {
      var imageLink = mlib.link(c.image, 'blob')
      if (imageLink) {
        // remove old assignment, if it exists
        for (var image in author.images) {
          author.images[image] = author.images[image].filter(function (id) { return id !== author.id })
          if (!author.images[image][0])
            delete author.images[image]
        }

        // add new assignment
        author.self.image = imageLink
        if (author.id == sbot.id)
          author.byMe.image = imageLink
        author.images[imageLink.link] = (author.images[imageLink.link]||[]).concat(author.id)
      }
    }
  }

  function updateOtherContact (source, target, msg) {
    var c = msg.value.content
    source = getProfile(source)
    target = getProfile(target)

    // name: a non-empty string
    if (nonEmptyStr(c.name)) {
      var safeName = makeNameSafe(c.name)

      // remove old assignment, if it exists
      for (var name in target.names) {
        target.names[name] = target.names[name].filter(function (id) { return id !== source.id })
        if (!target.names[name][0])
          delete target.names[name]
      }

      // add new assignment
      target.names[safeName] = (target.names[safeName]||[]).concat(source.id)
      if (source.id === sbot.id)
        target.byMe.name = safeName
      rebuildNamesFor(target)
    }

    // image: link to image
    if ('image' in c) {
      var imageLink = mlib.link(c.image, 'blob')
      if (imageLink) {
        // remove old assignment, if it exists
        for (var image in target.images) {
          target.images[image] = target.images[image].filter(function (id) { return id !== source.id })
          if (!target.images[image][0])
            delete target.images[image]
        }

        // add new assignment
        target.images[imageLink.link] = (target.images[imageLink.link]||[]).concat(source.id)
        if (source.id == sbot.id)
          target.byMe.image = imageLink
      }
    }

    // following: bool
    if (typeof c.following === 'boolean') {
      if (c.following)
        target.followers[source.id] = true
      else
        delete target.followers[source.id]

      // if from the user, update names (in case un/following changes conflict status)
      if (msg.value.author == sbot.id)
        rebuildNamesFor(target)
    }
  }

  function rebuildNamesFor (profile) {
    profile = getProfile(profile)

    // remove oldname from id->name map
    var oldname = state.names[profile.id]
    if (oldname) {
      if (state.ids[oldname] == profile.id) {
        // remove
        delete state.ids[oldname]
      } else if (Array.isArray(state.ids[oldname])) {
        // is in a conflict, remove from conflict array
        var i = state.ids[oldname].indexOf(profile.id)
        if (i !== -1) {
          state.ids[oldname].splice(i, 1)
          if (state.ids[oldname].length === 1) {
            // conflict resolved
            delete state.actionItems[oldname]
            state.ids[oldname] = state.ids[oldname][0]
          }
        }
      }
    }

    // default to self-assigned name
    var name = profile.self.name

    // override with name assigned by the local user
    if (profile.id !== sbot.id && profile.byMe.name)
      name = profile.byMe.name

    // abort if there's no name at all
    if (!name)
      return

    // store
    state.names[profile.id] = name

    // if following, update id->name map
    if (profile.id === sbot.id || profile.followers[sbot.id]) {
      if (!state.ids[name]) { // no conflict?
        // take it
        state.ids[name] = profile.id
      } else {
        // keep track of all assigned ids
        if (Array.isArray(state.ids[name]))
          state.ids[name].push(profile.id)
        else
          state.ids[name] = [state.ids[name], profile.id]
        // conflict, this needs to be handled by the user
        state.actionItems[name] = {
          type: 'name-conflict',
          name: name,
          ids: state.ids[name]
        }
      }
    }
  }

  function attachIsRead (indexRow, key) {
    key = key || indexRow.key
    state.pinc()
    db.isread.get(key, function (err, v) {
      indexRow.isRead = !!v
      state.pdec()
    })
  }

  // look up the child and root isread state, combine them with the current row's isread state
  function attachChildIsRead (indexRow, childKey, cb) {
    state.pinc()
    var rootIsRead, childIsRead

    // get child isread
    db.isread.get(childKey, function (err, v) {
      childIsRead = !!v
      next()
    })

    // lookup the root isread from DB if not already on the row
    if (typeof indexRow.isRead == 'boolean') {
      rootIsRead = indexRow.isRead
    } else {
      db.isread.get(indexRow.key, function (err, v) {
        rootIsRead = !!v
        next()
      })      
    }

    function next () {
      // wait for both
      if (typeof rootIsRead != 'boolean' || typeof childIsRead != 'boolean')
        return

      // combine child and root isread state
      indexRow.isRead = rootIsRead && childIsRead
      
      cb && cb(null, indexRow.isRead)
      state.pdec() // call this last, after all async work is done
    }
  }

  function follows (a, b) {
    if (a.id) a = a.id // if `a` is a profile, just get its id
    if (b.id) b = b.id // if `b` is a profile, just get its id
    return (a != b && getProfile(b).followers[a])
  }

  // helper to get the most reliable timestamp for a message
  // - stops somebody from boosting their ranking (accidentally, maliciously) with a future TS
  // - applies only when ordering by most-recent
  function ts (msg) {
    return Math.min(msg.received, msg.value.timestamp)
  }

  // exported api

  function fn (logkey) {
    state.pinc()
    var key = logkey.value
    sbot.get(logkey.value, function (err, value) {
      var msg = { key: key, value: value, received: logkey.key }
      try {
        // encrypted? try to decrypt
        if (typeof value.content == 'string' && value.content.slice(-4) == '.box') {
          value.content = sbot.private.unbox(value.content)
          if (!value.content)
            return state.pdec()
        }

        // collect keys of user's messages
        if (msg.value.author === sbot.id)
          state.mymsgs.push(msg.key)

        // type processing
        var process = processors[msg.value.content.type]
        if (process)
          process(msg)
      }
      catch (e) {
        // :TODO: use sbot logging plugin
        console.error('Failed to process message', e, e.stack, key, value)
      }
      state.pdec()
    })
  }

  return fn
}

function nonEmptyStr (str) {
    return (typeof str === 'string' && !!(''+str).trim())
  }

// allow A-z0-9._-, dont allow a trailing .
var badNameCharsRegex = /[^A-z0-9\._-]/g
function makeNameSafe (str) {
  str = str.replace(badNameCharsRegex, '_')
  if (str.charAt(str.length - 1) == '.')
    str = str.slice(0, -1) + '_'
  return str
}