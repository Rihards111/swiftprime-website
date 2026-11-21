// Open / close a project case. While a case is open, cards stop stacking so the case can be read.
document.querySelectorAll('.case-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    var opening = btn.getAttribute('aria-expanded') !== 'true';
    document.querySelectorAll('.case-btn').forEach(function (other) {
      if (other !== btn) {
        other.setAttribute('aria-expanded', 'false');
        other.textContent = 'Open case →';
        document.getElementById(other.getAttribute('aria-controls')).hidden = true;
      }
    });
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    btn.textContent = opening ? 'Close case ↑' : 'Open case →';
    panel.hidden = !opening;
    document.body.classList.toggle('case-open', opening);
    if (!opening) { btn.closest('.project').scrollIntoView({ block: 'start' }); }
  });
});

// Cookie choice: Microsoft Clarity loads only after "Accept". The choice is remembered in this browser.
(function () {
  var id = window.CLARITY_ID, box = document.getElementById('cookie');
  if (!id || !box) return;
  var KEY = 'sp-consent';
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function load() {
    if (window.clarity) return;
    (function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",id);
    window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
  }
  var choice = get();
  if (choice === 'yes') load(); else if (choice !== 'no') box.hidden = false;
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-consent]'); if (!b) return;
    var v = b.getAttribute('data-consent'); set(v); box.hidden = true;
    if (v === 'yes') load();
    else if (window.clarity) { window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' }); }
  });
  document.querySelectorAll('[data-cookie-settings]').forEach(function (b) {
    b.addEventListener('click', function () { box.hidden = false; });
  });
})();
