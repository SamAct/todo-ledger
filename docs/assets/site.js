(function () {
  'use strict'
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
    return new Promise(function (ok, no) {
      var t = document.createElement('textarea')
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'
      document.body.appendChild(t); t.select()
      try { document.execCommand('copy') ? ok() : no() } catch (e) { no(e) } finally { document.body.removeChild(t) }
    })
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.cmd button')
    if (!b) return
    var code = b.parentElement.querySelector('code')
    copy(code.getAttribute('data-copy') || code.textContent).then(function () {
      b.setAttribute('data-done', ''); b.textContent = 'Copied'
      setTimeout(function () { b.removeAttribute('data-done'); b.textContent = 'Copy' }, 1600)
    }, function () { b.textContent = 'Select' })
  })

  var els = document.querySelectorAll('.rv')
  if ('IntersectionObserver' in window && els.length) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target) } })
    }, { rootMargin: '0px 0px -8% 0px' })
    els.forEach(function (el) { io.observe(el) })
  } else els.forEach(function (el) { el.classList.add('in') })
})()
