'use babel'
import React from 'react'
import { Router, Route, IndexRoute } from 'react-router'
import app from './lib/app'
import Layout from './layout'
import Inbox from './views/inbox'
import Feed from './views/feed'
import Notices from './views/notices'
import Data from './views/data'
import Msg from './views/msg'
import Composer from './views/composer'
import Contacts from './views/contacts'
import Profile from './views/profile'
import Sync from './views/sync'
import Search from './views/search'

function beforeNavigation (nextState) {
  if (nextState.action === 'PUSH') { // only on new navs, not on back-btn-driven navs
    // capture scroll position of all vertical-filled components
    var vfScrollTops = {}
    var vfEls = [].slice.call(document.querySelectorAll('.vertical-filled'))
    vfEls.forEach(el => {
      if (el.id)
        vfScrollTops[el.id] = el.scrollTop
    })
    window.history.replaceState({ vfScrollTops: vfScrollTops }, '')
  }
}
app.history.listenBefore(beforeNavigation)

export var routes = (
  <Router history={app.history}>
    <Route path="/" component={Layout}>
      <IndexRoute component={Inbox} />
      <Route path="inbox" component={Inbox} />
      <Route path="inbox/:view" component={Inbox} />
      <Route path="feed" component={Feed} />
      <Route path="notices" component={Notices} />
      <Route path="data" component={Data} />
      <Route path="contacts" component={Contacts} />
      <Route path="profile" component={Contacts} />
      <Route path="profile/:id" component={Profile} />
      <Route path="msg/:id" component={Msg} />
      <Route path="composer" component={Composer} />
      <Route path="sync" component={Sync} />
      <Route path="search/:query" component={Search} />
    </Route>
  </Router>
)