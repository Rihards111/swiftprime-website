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
