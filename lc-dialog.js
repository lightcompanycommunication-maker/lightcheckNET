/* ============================================================
   Light Check — Boîte de dialogue de marque
   ------------------------------------------------------------
   Les popups NATIFS du navigateur (alert/confirm/prompt) affichent
   toujours le domaine de la page (« xxx.replit.app indique : »).
   Ce texte est imposé par le navigateur et NE PEUT PAS être modifié.
   On remplace donc l'alerte native par une boîte maison « Light Check »
   (sans URL). lcConfirm / lcPrompt sont dispo si on veut aussi
   remplacer confirm()/prompt() plus tard (versions async).
   À charger juste après config.js sur chaque page.
   ============================================================ */
(function () {
  if (window.__lcDialogInstalled) return;
  window.__lcDialogInstalled = true;

  function injectStyle() {
    if (document.getElementById('lc-dialog-style')) return;
    var s = document.createElement('style');
    s.id = 'lc-dialog-style';
    s.textContent = [
      '.lcd-overlay{position:fixed;inset:0;background:rgba(16,24,40,.55);z-index:2147483000;',
      'display:flex;align-items:center;justify-content:center;padding:20px;animation:lcdFade .15s ease;}',
      '@keyframes lcdFade{from{opacity:0}to{opacity:1}}',
      '@keyframes lcdPop{from{transform:translateY(8px) scale(.98);opacity:0}to{transform:none;opacity:1}}',
      '.lcd-box{background:#fff;border-radius:16px;max-width:400px;width:100%;padding:22px 22px 18px;',
      'box-shadow:0 22px 55px rgba(16,24,40,.28);font-family:Arial,Helvetica,sans-serif;animation:lcdPop .18s ease;}',
      '.lcd-head{display:flex;align-items:center;gap:9px;margin-bottom:12px;}',
      '.lcd-logo{width:28px;height:28px;border-radius:50%;background:#111;display:flex;align-items:center;',
      'justify-content:center;flex:0 0 auto;}',
      '.lcd-logo span{width:11px;height:11px;border-radius:50%;background:#FFCF00;display:block;}',
      '.lcd-title{font-weight:800;font-size:1rem;color:#1a1a1a;letter-spacing:-.01em;}',
      '.lcd-title b{color:#FFCF00;}',
      '.lcd-msg{font-size:.93rem;color:#344054;line-height:1.55;white-space:pre-wrap;',
      'word-break:break-word;margin:0 2px 18px;}',
      '.lcd-actions{display:flex;gap:10px;justify-content:flex-end;}',
      '.lcd-btn{border:none;border-radius:10px;padding:10px 20px;font-size:.9rem;font-weight:700;',
      'cursor:pointer;font-family:inherit;transition:filter .12s ease;}',
      '.lcd-btn:hover{filter:brightness(.96);}',
      '.lcd-ok{background:#FFCF00;color:#1a1a1a;}',
      '.lcd-cancel{background:#eef0f3;color:#344054;}',
      '.lcd-input{width:100%;box-sizing:border-box;border:1px solid #d6dae0;border-radius:10px;',
      'padding:10px 12px;font-size:.93rem;font-family:inherit;margin:0 0 16px;outline:none;}',
      '.lcd-input:focus{border-color:#FFCF00;box-shadow:0 0 0 3px rgba(255,207,0,.25);}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  // Construit l'ossature de la boîte (en-tête « Light Check » + message)
  function build(message) {
    injectStyle();
    var ov = document.createElement('div');
    ov.className = 'lcd-overlay';

    var box = document.createElement('div');
    box.className = 'lcd-box';

    var head = document.createElement('div');
    head.className = 'lcd-head';
    var logo = document.createElement('div');
    logo.className = 'lcd-logo';
    logo.innerHTML = '<span></span>';
    var title = document.createElement('div');
    title.className = 'lcd-title';
    title.innerHTML = 'Light <b>Check</b>';
    head.appendChild(logo);
    head.appendChild(title);

    var msg = document.createElement('div');
    msg.className = 'lcd-msg';
    msg.textContent = (message == null ? '' : String(message));

    var actions = document.createElement('div');
    actions.className = 'lcd-actions';

    box.appendChild(head);
    box.appendChild(msg);
    ov.appendChild(box);
    return { ov: ov, box: box, msg: msg, actions: actions };
  }

  function mount(ov) { (document.body || document.documentElement).appendChild(ov); }

  // --- ALERTE de marque (remplace alert) -------------------------------
  function lcAlert(message) {
    return new Promise(function (resolve) {
      var m = build(message);
      var ok = document.createElement('button');
      ok.className = 'lcd-btn lcd-ok';
      ok.textContent = 'OK';
      m.actions.appendChild(ok);
      m.box.appendChild(m.actions);

      function close() {
        m.ov.remove();
        document.removeEventListener('keydown', onKey);
        resolve();
      }
      function onKey(e) { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); close(); } }
      ok.addEventListener('click', close);
      m.ov.addEventListener('click', function (e) { if (e.target === m.ov) close(); });
      document.addEventListener('keydown', onKey);
      mount(m.ov);
      setTimeout(function () { try { ok.focus(); } catch (e) {} }, 0);
    });
  }

  // --- CONFIRMATION de marque (version async, optionnelle) -------------
  function lcConfirm(message) {
    return new Promise(function (resolve) {
      var m = build(message);
      var cancel = document.createElement('button');
      cancel.className = 'lcd-btn lcd-cancel';
      cancel.textContent = 'Annuler';
      var ok = document.createElement('button');
      ok.className = 'lcd-btn lcd-ok';
      ok.textContent = 'Confirmer';
      m.actions.appendChild(cancel);
      m.actions.appendChild(ok);
      m.box.appendChild(m.actions);

      function done(val) {
        m.ov.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
        else if (e.key === 'Enter') { e.preventDefault(); done(true); }
      }
      ok.addEventListener('click', function () { done(true); });
      cancel.addEventListener('click', function () { done(false); });
      m.ov.addEventListener('click', function (e) { if (e.target === m.ov) done(false); });
      document.addEventListener('keydown', onKey);
      mount(m.ov);
      setTimeout(function () { try { ok.focus(); } catch (e) {} }, 0);
    });
  }

  // --- SAISIE de marque (version async, optionnelle) ------------------
  function lcPrompt(message, defaultValue) {
    return new Promise(function (resolve) {
      var m = build(message);
      var input = document.createElement('input');
      input.className = 'lcd-input';
      input.type = 'text';
      input.value = (defaultValue == null ? '' : String(defaultValue));
      m.box.appendChild(input);

      var cancel = document.createElement('button');
      cancel.className = 'lcd-btn lcd-cancel';
      cancel.textContent = 'Annuler';
      var ok = document.createElement('button');
      ok.className = 'lcd-btn lcd-ok';
      ok.textContent = 'Valider';
      m.actions.appendChild(cancel);
      m.actions.appendChild(ok);
      m.box.appendChild(m.actions);

      function done(val) {
        m.ov.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
        else if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
      }
      ok.addEventListener('click', function () { done(input.value); });
      cancel.addEventListener('click', function () { done(null); });
      m.ov.addEventListener('click', function (e) { if (e.target === m.ov) done(null); });
      document.addEventListener('keydown', onKey);
      mount(m.ov);
      setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 0);
    });
  }

  // Remplace l'alerte native (qui affiche l'URL) par la boîte de marque.
  // alert() ne renvoie rien -> aucun risque pour le code existant.
  window.alert = function (msg) { lcAlert(msg); };

  // Disponibles si on veut remplacer confirm()/prompt() plus tard.
  window.lcAlert = lcAlert;
  window.lcConfirm = lcConfirm;
  window.lcPrompt = lcPrompt;
})();
