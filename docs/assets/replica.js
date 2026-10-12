/* Interactive replica of the todo-ledger sidebar. Plain JS, no dependencies, no network. */
(function () {
  'use strict'

  var PROJECT = 'billing-api'
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  var GROUPS = [
    { kind: 'proposal', label: 'Needs decision', dec: true },
    { kind: 'todo', label: 'To do' },
    { kind: 'discussion', label: 'Discussion' },
    { kind: 'deferred', label: 'Parked' },
  ]

  var WEBHOOK = {
    id: '20261012-0951-3c1f', kind: 'deferred', origin: 'agent', status: 'open', project: PROJECT, session: 'webhook-fix', age: 0,
    title: 'Retry failed webhook deliveries',
    body: 'Failed webhook deliveries are dropped today, so a missed payment update never arrives. Retrying a few times would fix that. Left out so this fix stays small.',
    notes: [],
  }

  function seed() {
    return [
      { id: '20261012-0908-a41e', kind: 'proposal', origin: 'agent', status: 'open', project: PROJECT, session: 'checkout-speed', age: 12,
        title: 'Move invoice emails to a background queue',
        body: 'Invoice emails are sent while the customer waits at checkout, which slows the page down. A queue would let checkout finish first and send the email a few seconds later. Proposed because checkout is the slowest step today.',
        notes: [{ by: 'agent', text: 'Found while reading slow checkout traces.' }] },
      { id: '20261012-0731-77b2', kind: 'todo', origin: 'agent', status: 'open', project: PROJECT, session: 'refund-fix', age: 120,
        title: 'Add tests for the refund endpoint',
        body: 'The refund code changed twice this week and has no tests. A few simple cases would catch a mistake before a customer does.', notes: [] },
      { id: '20261009-1612-0d9a', kind: 'discussion', origin: 'agent', status: 'open', project: PROJECT, session: 'api-cleanup', age: 4320,
        title: 'Keep or remove the old v1 API?',
        body: 'The old v1 API still gets a small trickle of calls. Removing it would simplify the code, but some partners may still rely on it. Worth deciding before the next release.', notes: [] },
      { id: '20261010-0905-e5c0', kind: 'todo', origin: 'human', status: 'open', project: PROJECT, session: '', age: 2880,
        title: 'Rotate the staging API key', body: '', notes: [] },
      { id: '20261012-0640-42ff', kind: 'todo', origin: 'human', status: 'open', project: PROJECT, session: '', age: 300,
        title: 'Write release notes for 2.4', body: '', notes: [] },
      { id: '20261011-1120-b83d', kind: 'todo', origin: 'agent', status: 'done', project: PROJECT, session: 'db-tidy', age: 1440,
        title: 'Rename the payments table', body: 'The old name no longer matches what the table holds. Renamed with a migration and the code updated.', notes: [] },
      { id: '20261008-1410-91ac', kind: 'proposal', origin: 'agent', status: 'dropped', project: PROJECT, session: 'email-vendor', age: 5760,
        title: 'Switch to a different email vendor', body: 'Proposed to cut cost. Turned down: the current vendor is staying.', notes: [{ by: 'human', text: 'Not now, contract runs to March.' }] },
      { id: '20261011-0830-c2d1', kind: 'todo', origin: 'agent', status: 'open', project: 'mobile-app', session: 'picker-bug', age: 1500,
        title: 'Fix the date picker on small screens',
        body: 'On narrow phones the date picker runs off the edge and the last day cannot be tapped. Needs a layout fix and a check on two small devices.', notes: [] },
      { id: '20261010-1700-fa31', kind: 'deferred', origin: 'agent', status: 'open', project: 'mobile-app', session: 'avatar-speed', age: 2700,
        title: 'Cache user avatars on the device',
        body: 'Avatars are downloaded again on every launch. Caching them would make the home screen feel faster. Left out of the speed fix to keep it small.', notes: [] },
      { id: '20261012-0540-1e77', kind: 'proposal', origin: 'agent', status: 'open', project: 'docs-site', session: 'auth-docs', age: 370,
        title: 'Document the new sign-in flow',
        body: 'Sign-in changed last week but the guide still describes the old steps. A short page with the new steps would stop support questions.', notes: [] },
    ]
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] })
  }
  function ageText(m) {
    if (m < 1) return 'now'
    if (m < 60) return Math.floor(m) + 'm'
    if (m < 1440) return Math.floor(m / 60) + 'h'
    return Math.floor(m / 1440) + 'd'
  }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s }
  var isOpen = function (i) { return i.status === 'open' || i.status === 'in_progress' }

  var SVG = {
    fill: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l5 5-5 5-5-5z" fill="currentColor"/></svg>',
    ring: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.6l4.4 4.4L6 10.4 1.6 6z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    dot: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="2.4" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 6.4l2.4 2.4 5.2-5.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cross: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    caret: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  }
  function markFor(i) {
    if (i.status === 'done') return SVG.check
    if (i.status === 'dropped') return SVG.cross
    return i.kind === 'proposal' ? SVG.fill : i.kind === 'todo' ? SVG.dot : SVG.ring
  }
  function tabOf(i) { return !isOpen(i) ? 'done' : i.origin === 'agent' ? 'agent' : 'human' }

  function startPrompt(i) {
    var lines = ['Work on this ledger item (id ' + i.id + ', ' + i.kind + ', from project ' + i.project + '):', i.title]
    if (i.body) lines.push(i.body)
    if (i.notes.length) { lines.push('Notes:'); i.notes.forEach(function (n) { lines.push('- ' + n.by + ': ' + n.text) }) }
    if (i.project !== PROJECT) lines.push('Note: this item came from a different project (' + i.project + '); this session is in ' + PROJECT + '.')
    lines.push('When finished, call update_item with id ' + i.id + ' and status done.')
    return lines.join('\n')
  }

  function mount(root) {
    var mode = root.getAttribute('data-replica') === 'pane' ? 'pane' : 'full'
    var story = root.hasAttribute('data-story')
    var items = seed()
    if (!story) items.unshift(Object.assign({}, WEBHOOK))
    var st = { tab: 'agent', all: false, sel: null, starting: null, noting: false, delConfirm: false, notesAll: false, open: true }
    var timers = []
    var toastTimer = 0

    root.classList.add('lr-win')
    root.setAttribute('data-mode', mode)
    root.setAttribute('role', 'group')
    root.setAttribute('aria-label', 'Interactive preview of the ToDo’s sidebar')
    root.innerHTML =
      '<div class="lr-bar"><span class="lr-ttl">' + PROJECT + '</span></div>' +
      '<div class="lr-body">' +
        (mode === 'full' ? '<div class="lr-chat" aria-hidden="true"></div>' : '') +
        '<aside class="lr-pane" aria-label="ToDo’s sidebar">' +
          '<div class="lr-head"><h4>ToDo’s</h4>' + (mode === 'full' ? '<button class="lr-x" type="button" aria-label="Close sidebar">✕</button>' : '') + '</div>' +
          '<button class="lr-scope" type="button" aria-label="Switch between this project and all projects"></button>' +
          '<div class="lr-tabs"></div>' +
          '<div class="lr-list"></div>' +
          '<div class="lr-toast" role="status" aria-live="polite"></div>' +
        '</aside>' +
      '</div>' +
      (mode === 'full' ? '<div class="lr-foot"><div class="lr-prompt" aria-hidden="true">Reply to Claude…</div><button class="lr-band" type="button" aria-pressed="true"><span class="bars"></span><span class="lr-band-t"></span></button></div>' : '')

    var $ = function (s) { return root.querySelector(s) }
    var chat = $('.lr-chat'), list = $('.lr-list'), tabsEl = $('.lr-tabs'), scopeEl = $('.lr-scope'),
        toastEl = $('.lr-toast'), prompt = $('.lr-prompt'), band = $('.lr-band')

    function scoped() { return items.filter(function (i) { return st.all || i.project === PROJECT }) }
    function inTab(tab) {
      var rows = scoped().filter(function (i) { return tabOf(i) === tab })
      return rows.sort(function (a, b) { return a.age - b.age })
    }
    function order(tab) {
      var rows = inTab(tab)
      if (tab === 'done') return rows
      var out = []
      GROUPS.forEach(function (g) { rows.forEach(function (i) { if (i.kind === g.kind) out.push(i) }) })
      return out
    }
    function find(id) { return items.filter(function (i) { return i.id === id })[0] }

    function toast(msg) {
      toastEl.textContent = msg
      toastEl.classList.add('on')
      clearTimeout(toastTimer)
      toastTimer = setTimeout(function () { toastEl.classList.remove('on') }, 2600)
    }

    function pills(i) {
      var s = '<span class="lr-pill p">' + esc(i.project) + '</span>'
      if (i.session) s += '<span class="lr-pill s">' + esc(i.session) + '</span>'
      return s + '<span class="lr-pill a">' + ageText(i.age) + '</span>'
    }

    function rowHTML(i, dec, flash) {
      return '<button type="button" class="lr-row' + (flash ? ' flash' : '') + '" data-id="' + i.id + '"' + (isOpen(i) ? '' : ' data-closed') + '>' +
        '<span class="lr-mark' + (dec ? ' dec' : '') + '">' + markFor(i) + '</span>' +
        '<span><span class="lr-title">' + esc(i.title) + '</span><span class="lr-meta">' + pills(i) + '</span></span></button>'
    }

    function cardHTML(i) {
      var notes = i.notes, hidden = 0
      if (!st.notesAll && notes.length > 3) { hidden = notes.length - 3; notes = notes.slice(-3) }
      var h = '<div class="lr-card" data-card="' + i.id + '"><div class="lr-card-h"><span class="lr-title">' + esc(i.title) + '</span>' +
        '<button type="button" class="lr-close" data-a="close">Close</button></div>' +
        '<span class="lr-meta" style="display:flex;margin-top:.45rem">' + pills(i) + '</span>'
      if (i.body) h += '<p class="lr-detail">' + esc(i.body) + '</p>'
      if (i.notes.length) {
        h += '<div class="lr-notes">'
        if (hidden) h += '<button type="button" class="lr-more" data-a="more">Show ' + hidden + ' earlier</button>'
        notes.forEach(function (n) { h += '<div class="lr-note"><b>' + n.by + '</b>' + esc(n.text) + '</div>' })
        h += '</div>'
      }
      if (st.noting) {
        h += '<textarea class="lr-in" rows="2" placeholder="Write a note, press Enter to save" aria-label="Note"></textarea>' +
          '<div class="lr-acts"><button type="button" class="lr-btn plain" data-a="note-cancel">Cancel</button></div>'
      } else if (!isOpen(i)) {
        h += '<div class="lr-acts">'
        if (st.delConfirm) h += '<button type="button" class="lr-btn" data-a="del-yes">Confirm delete</button><button type="button" class="lr-btn plain" data-a="del-no">Cancel</button>'
        else {
          h += '<button type="button" class="lr-btn pri" data-a="reopen">Reopen</button>'
          if (i.status === 'dropped') h += '<button type="button" class="lr-btn" data-a="del">Delete forever</button>'
        }
        h += '</div>'
      } else if (st.starting === i.id) {
        h += '<div class="lr-acts"><button type="button" class="lr-btn pri" data-a="send">Send</button><button type="button" class="lr-btn" data-a="draft">Draft</button>' +
          '<button type="button" class="lr-btn" data-a="copy">Copy</button><button type="button" class="lr-btn plain" data-a="start-cancel">Cancel</button></div>'
      } else {
        h += '<div class="lr-acts"><button type="button" class="lr-btn" data-a="start">Start</button>'
        if (i.kind === 'proposal') h += '<button type="button" class="lr-btn pri" data-a="approve">Approve</button><button type="button" class="lr-btn" data-a="drop">Reject</button>'
        else h += '<button type="button" class="lr-btn" data-a="done">Done</button><button type="button" class="lr-btn" data-a="drop">Drop</button>'
        h += '<button type="button" class="lr-btn" data-a="note">Note</button></div>'
      }
      return h + '</div>'
    }

    var flashId = null
    function draw() {
      var counts = { agent: inTab('agent').length, human: inTab('human').length, done: inTab('done').length }
      scopeEl.innerHTML = (st.all ? 'All projects' : 'This project') + SVG.caret
      tabsEl.innerHTML = ['agent', 'human', 'done'].map(function (t) {
        return '<button type="button" class="lr-tab" data-tab="' + t + '" aria-pressed="' + (st.tab === t) + '" aria-selected="' + (st.tab === t) + '">' +
          t.charAt(0).toUpperCase() + t.slice(1) + ' <i>' + counts[t] + '</i></button>'
      }).join('')

      var rows = inTab(st.tab), html = ''
      if (!rows.length) html = '<div class="lr-empty">Nothing here.</div>'
      else if (st.tab === 'done') rows.forEach(function (i) { html += st.sel === i.id ? cardHTML(i) : rowHTML(i, false, flashId === i.id) })
      else GROUPS.forEach(function (g) {
        var gr = rows.filter(function (i) { return i.kind === g.kind })
        if (!gr.length) return
        html += '<div class="lr-gl' + (g.dec ? ' dec' : '') + '">' + (g.dec ? SVG.fill : g.kind === 'todo' ? SVG.dot : SVG.ring) + g.label + '</div>'
        gr.forEach(function (i) { html += st.sel === i.id ? cardHTML(i) : rowHTML(i, g.dec, flashId === i.id) })
      })
      var keepScroll = list.scrollTop
      list.innerHTML = html
      list.scrollTop = keepScroll
      flashId = null

      if (band) {
        var n = items.filter(function (i) { return isOpen(i) && i.project === PROJECT }).length
        root.querySelector('.lr-band-t').textContent = 'ToDo’s' + (n ? ' ' + n : '')
        band.setAttribute('aria-pressed', String(st.open))
      }
      root.classList.toggle('lr-closed', !st.open)
      var ta = list.querySelector('.lr-in')
      if (ta && !ta.dataset.focused) { ta.dataset.focused = '1'; ta.focus() }
    }

    function resetCard() { st.starting = null; st.noting = false; st.delConfirm = false; st.notesAll = false }
    function select(id) { resetCard(); st.sel = id; draw() }

    function advance(from) {
      var ord = order(st.tab), idx = ord.map(function (i) { return i.id }).indexOf(from)
      return ord.length ? ord[Math.min(Math.max(idx, 0), ord.length - 1)].id : null
    }
    function close(i, status, label) {
      var before = order(st.tab), at = before.map(function (x) { return x.id }).indexOf(i.id)
      i.status = status; i.age = 0
      var after = order(st.tab)
      resetCard()
      st.sel = after.length ? after[Math.min(at, after.length - 1)].id : null
      toast(label + clip(i.title, 38))
      draw()
    }

    var actions = {
      close: function () { select(null) },
      more: function () { st.notesAll = true; draw() },
      start: function (i) { st.starting = i.id; st.noting = false; draw() },
      'start-cancel': function () { st.starting = null; draw() },
      note: function () { st.noting = true; st.starting = null; draw() },
      'note-cancel': function () { st.noting = false; draw() },
      done: function (i) { close(i, 'done', 'Done: ') },
      drop: function (i) { close(i, 'dropped', i.kind === 'proposal' ? 'Rejected, moved to Done: ' : 'Dropped, moved to Done: ') },
      approve: function (i) { i.kind = 'todo'; resetCard(); toast('Approved, now a to do: ' + clip(i.title, 30)); draw() },
      reopen: function (i) { i.status = 'open'; i.age = 0; st.tab = tabOf(i); resetCard(); st.sel = i.id; toast('Reopened: ' + clip(i.title, 38)); draw() },
      del: function () { st.delConfirm = true; draw() },
      'del-no': function () { st.delConfirm = false; draw() },
      'del-yes': function (i) {
        var nxt = advance(i.id); items = items.filter(function (x) { return x !== i }); resetCard()
        var ord = order(st.tab); st.sel = ord.length ? (ord.some(function (x) { return x.id === nxt }) ? nxt : ord[0].id) : null
        toast('Deleted forever: ' + clip(i.title, 30)); draw()
      },
      send: function (i) {
        var p = startPrompt(i); resetCard(); draw()
        if (chat) { stopStory(); say('user', esc(clip(p.split('\n')[0] + ' ' + i.title, 110))); toast('Sending: ' + clip(i.title, 38)) }
        else toast('Sent to Claude: ' + clip(i.title, 34))
      },
      draft: function (i) {
        var p = startPrompt(i); resetCard(); draw()
        if (prompt) { prompt.textContent = p; prompt.classList.add('has') }
        toast(prompt ? 'Drafted in the prompt box' : 'Drafted in your prompt')
      },
      copy: function (i) {
        var p = startPrompt(i); resetCard(); draw()
        try { if (navigator.clipboard) navigator.clipboard.writeText(p) } catch (e) {}
        toast('Prompt copied')
      },
    }

    root.addEventListener('click', function (e) {
      var t = e.target.closest('button')
      if (!t || !root.contains(t)) return
      stopStory()
      if (t.classList.contains('lr-x') || t.classList.contains('lr-band')) { st.open = !st.open; draw(); return }
      if (t.classList.contains('lr-scope')) { st.all = !st.all; st.sel = null; resetCard(); draw(); return }
      if (t.dataset.tab) { st.tab = t.dataset.tab; st.sel = null; resetCard(); draw(); return }
      if (t.classList.contains('lr-row')) { select(st.sel === t.dataset.id ? null : t.dataset.id); return }
      var a = t.dataset.a, i = st.sel && find(st.sel)
      if (a && actions[a] && i) actions[a](i)
      if (a === 'close') select(null)
    })

    root.addEventListener('keydown', function (e) {
      var ta = e.target.closest && e.target.closest('.lr-in')
      if (ta) {
        if (e.key === 'Enter' && !e.shiftKey && ta.value.trim()) {
          e.preventDefault()
          var i = find(st.sel); i.notes.push({ by: 'human', text: ta.value.trim() }); i.age = 0
          st.noting = false; toast('Note added'); draw()
        } else if (e.key === 'Escape') { st.noting = false; draw() }
        return
      }
      if (e.key === 'Escape' && st.sel) { select(null); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      var tabKey = { '1': 'agent', '2': 'human', '3': 'done' }[e.key]
      if (tabKey) { e.preventDefault(); st.tab = tabKey; st.sel = null; resetCard(); draw(); return }
      if (!st.sel || e.target.closest('.lr-tabs,.lr-head,.lr-scope')) return
      var it = find(st.sel); if (!it || !isOpen(it)) return
      var map = st.starting ? { s: 'send', d: 'draft', c: 'copy' } : { s: 'start', d: 'done', x: 'drop', n: 'note', a: 'approve' }
      var k = map[e.key]
      if (!k) return
      if (k === 'approve' && it.kind !== 'proposal') return
      if (k === 'done' && it.kind === 'proposal') return
      e.preventDefault(); actions[k](it)
    })

    // story (hero only): Claude defers something and the row appears
    function say(who, html) {
      var d = document.createElement('div')
      d.className = 'lr-msg ' + who
      d.innerHTML = html
      chat.appendChild(d)
      while (chat.children.length > 6) chat.removeChild(chat.firstChild)
      return d
    }
    function tool(html) {
      var d = document.createElement('div')
      d.className = 'lr-tool'
      d.innerHTML = SVG.check + '<span>' + html + '</span>'
      chat.appendChild(d)
    }
    function later(fn, ms) { timers.push(setTimeout(fn, ms)) }
    function stopStory() { timers.forEach(clearTimeout); timers = [] }

    function parkNow() {
      var w = Object.assign({}, WEBHOOK)
      items.unshift(w)
      st.tab = 'agent'; st.all = false; flashId = w.id
      draw()
      toast('Parked: ' + w.title)
    }
    function playStory() {
      stopStory()
      items = items.filter(function (i) { return i.id !== WEBHOOK.id })
      chat.innerHTML = ''
      st.sel = null; st.tab = 'agent'; st.all = false; resetCard(); draw()
      if (prompt) { prompt.textContent = 'Reply to Claude…'; prompt.classList.remove('has') }
      var FIXED = 'Fixed. The handler now checks the signature <b>before</b> parsing the body. I left retries for later, since that is a bigger change.'
      var PARK = '<em>park_item</em> deferred · “Retry failed webhook deliveries”'
      say('user', 'Fix the webhook crash. Keep the change small.')
      if (reduce) {
        tool('Read <em>webhooks/handler.ts</em>'); tool('Edit <em>webhooks/handler.ts</em>'); tool('Ran tests · <em>14 passed</em>')
        say('ai', FIXED); tool(PARK); parkNow(); return
      }
      later(function () { tool('Read <em>webhooks/handler.ts</em>') }, 500)
      later(function () { tool('Edit <em>webhooks/handler.ts</em>') }, 1000)
      later(function () { tool('Ran tests · <em>14 passed</em>') }, 1500)
      later(function () { say('ai', FIXED) }, 2100)
      later(function () { tool(PARK) }, 3200)
      later(parkNow, 3600)
    }
    var openId = root.getAttribute('data-open'), pre = openId && find(openId)
    if (pre) {
      st.tab = tabOf(pre); st.sel = pre.id
      if (root.hasAttribute('data-starting')) st.starting = pre.id
    }
    if (story && chat) {
      root.__replay = playStory
      if ('IntersectionObserver' in window) {
        var started = false
        new IntersectionObserver(function (es, ob) {
          if (!started && es[0].isIntersecting) { started = true; ob.disconnect(); playStory() }
        }, { threshold: 0.35 }).observe(root)
      } else playStory()
    } else draw()
    if (story && chat) { chat.innerHTML = ''; draw() }
    if (pre) {
      var card = list.querySelector('.lr-card')
      if (card) list.scrollTop = Math.max(0, card.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 12)
    }
  }

  function init() {
    var roots = document.querySelectorAll('[data-replica]')
    for (var k = 0; k < roots.length; k++) mount(roots[k])
    var rp = document.querySelectorAll('[data-replay]')
    for (var j = 0; j < rp.length; j++) rp[j].addEventListener('click', function () {
      var t = document.querySelector('[data-story]'); if (t && t.__replay) t.__replay()
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init()
})()
