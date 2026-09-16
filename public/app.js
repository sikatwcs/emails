const $ = id => document.getElementById(id);
const token = location.pathname.startsWith('/i/') ? location.pathname.split('/')[2] : null;
let primaryEmail = '';
let randomLength = 12;
const show = (id, yes) => $(id).classList.toggle('hidden', !yes);

async function api(url, options={}) {
  const response = await fetch(url, { credentials:'same-origin', headers: {'Content-Type':'application/json'}, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Permintaan gagal (${response.status}).`);
  return data;
}

function note(id, message, error=false) { $(id).textContent = message; $(id).classList.toggle('error', error); }
function el(tag, className, text) { const x=document.createElement(tag); if(className) x.className=className; if(text!==undefined) x.textContent=text; return x; }
function date(value) { return value ? new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—'; }

async function loadAdmin() {
  const data = await api('/api/settings');
  const imap = data.imap;
  primaryEmail = imap?.email || '';
  $('connection-pill').textContent = imap ? `Terhubung: ${imap.email}` : 'Belum terhubung';
  $('connection-pill').classList.toggle('connected', !!imap);
  if (imap) {
    const form = $('imap-form');
    form.elements.host.value = imap.host;
    form.elements.port.value = imap.port;
    form.elements.email.value = imap.email;
    if (!$('inbox-form').elements.address.value) $('inbox-form').elements.address.value = imap.email;
  }
  const c = await api('/api/provider/settings').catch(() => ({}));
  randomLength = Number(c.localLength || 12);
  const form = $('cloudmail-form');
  for (const key of ['apiUrl','publicUrl','localLength']) if (c[key] !== undefined) form.elements[key].value = c[key];
  form.elements.catchAllConfirmed.checked = !!c.catchAllConfirmed;
  for (const key of ['autoMailboxUser','keepFailedMailbox','useForSignup','useForRebind']) form.elements[key].checked = !!c[key];
  $('provider-status').textContent = c.ready ? 'SIAP DIPAKAI' : 'BUAT TOKEN';
  $('provider-status').classList.toggle('optional', !c.ready);
  const list = $('inbox-list'); list.replaceChildren();
  if (!data.inboxes.length) {
    list.append(el('p','empty-state', imap ? 'Belum ada tautan inbox. Buat tautan pertama di atas.' : 'Hubungkan akun Hostinger di Pengaturan koneksi terlebih dahulu.'));
  } else for (const inbox of data.inboxes) {
    const row=el('div','inbox-row'); const body=el('div');
    body.append(el('strong','',inbox.label),el('span','',`${inbox.address} · berlaku sampai ${date(inbox.expiresAt)}`));
    const revoke=el('button','text-button','Cabut tautan'); revoke.type='button';
    revoke.onclick=async()=>{ if(!confirm(`Cabut tautan untuk ${inbox.address}?`)) return; try{await api(`/api/inboxes/${inbox.id}`,{method:'DELETE'});await loadAdmin();}catch(e){alert(e.message);} };
    row.append(body,revoke); list.append(row);
  }
}

function tab(name) {
  show('inboxes-panel',name==='inboxes'); show('settings-panel',name==='settings');
  $('tab-inboxes').classList.toggle('active',name==='inboxes');
  $('tab-settings').classList.toggle('active',name==='settings');
}

async function initAdmin() {
  const session = await api('/api/session');
  show('login-view',!session.admin); show('admin-view',session.admin); show('logout-btn',session.admin && !session.local);
  if(session.admin) await loadAdmin();
}

function publicPlaceholder(title, body) {
  $('mail-list').replaceChildren(el('p','empty-state',body));
  $('mail-count').textContent='—';
  $('mail-detail').replaceChildren(el('div','mail-placeholder',title));
}

async function loadPublic() {
  publicPlaceholder('Sedang memuat…','Mengambil pesan dari kotak surat.');
  try {
    const data=await api(`/api/inbox/${encodeURIComponent(token)}`);
    $('public-label').textContent=data.inbox.label;
    $('public-address').textContent=data.inbox.address;
    $('public-expiry').textContent=`Tautan berlaku sampai ${date(data.inbox.expiresAt)}.`;
    $('mail-count').textContent=`${data.messages.length} pesan`;
    const list=$('mail-list'); list.replaceChildren();
    if(!data.messages.length) list.append(el('p','empty-state','Belum ada pesan untuk alamat ini. Pastikan alamat atau alias sudah menerima email di Hostinger.'));
    for(const message of data.messages) {
      const row=el('button','mail-row'); row.type='button';
      const top=el('div','mail-row-top'); top.append(el('span','mail-row-from',message.from),el('span','',date(message.date)));
      row.append(top,el('span','mail-row-subject',message.subject),el('span','mail-row-preview',message.preview || 'Tidak ada pratinjau teks.'));
      row.onclick=async()=>{
        for(const other of list.querySelectorAll('.mail-row')) other.classList.remove('selected'); row.classList.add('selected');
        $('mail-detail').replaceChildren(el('div','mail-placeholder','Membuka pesan…'));
        try { renderMail(await api(`/api/inbox/${encodeURIComponent(token)}/mail/${message.uid}`)); }
        catch(e) { $('mail-detail').replaceChildren(el('div','mail-placeholder',e.message)); }
      };
      list.append(row);
    }
    $('mail-detail').replaceChildren(el('div','mail-placeholder',data.messages.length ? 'Pilih pesan untuk membaca.' : 'Inbox ini masih kosong.'));
  } catch(e) { publicPlaceholder('Inbox tidak tersedia',e.message); }
}

function renderMail(message) {
  const wrap=el('div','mail-detail');
  wrap.append(el('p','eyebrow','PESAN MASUK'),el('h2','',message.subject));
  for(const [label,value] of [['Dari',message.from],['Ke',message.to],['Tanggal',date(message.date)]]) {
    const row=el('div','mail-meta'); row.append(el('strong','',label),el('span','',value || '—')); wrap.append(row);
  }
  wrap.append(el('div','mail-body',message.text || 'Pesan ini tidak memiliki versi teks yang dapat ditampilkan.'));
  if(message.attachments?.length) wrap.append(el('p','attachment-list',`Lampiran: ${message.attachments.map(x=>x.filename).join(', ')} (pratinjau saja)`));
  $('mail-detail').replaceChildren(wrap);
}

if(token) {
  show('public-view',true); $('refresh-public').onclick=loadPublic; loadPublic();
} else {
  initAdmin().catch(e=>{show('login-view',true);note('login-error',e.message,true);});
  $('login-form').onsubmit=async e=>{ e.preventDefault();try{await api('/api/login',{method:'POST',body:JSON.stringify({password:e.target.elements.password.value})});note('login-error','');e.target.reset();await initAdmin();}catch(error){note('login-error',error.message,true);} };
  $('logout-btn').onclick=async()=>{await api('/api/logout',{method:'POST'});await initAdmin();};
  $('tab-inboxes').onclick=()=>tab('inboxes'); $('tab-settings').onclick=()=>tab('settings');
  $('reload-admin').onclick=()=>loadAdmin().catch(e=>alert(e.message));
  $('random-address').onclick=()=>{
    if(!primaryEmail){note('inbox-form-note','Hubungkan kotak surat Hostinger terlebih dahulu.',true);return;}
    const alphabet='abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes=new Uint8Array(Math.min(50,Math.max(3,randomLength)));
    crypto.getRandomValues(bytes);
    const name=Array.from(bytes,x=>alphabet[x%alphabet.length]).join('');
    $('inbox-form').elements.address.value=`${name}@${primaryEmail.split('@')[1]}`;
    $('inbox-form').elements.label.value=`Inbox ${name}`;
    note('inbox-form-note','Alamat acak terisi. Aktifkan Catch-All di Hostinger agar email ke alamat ini benar-benar masuk.');
  };
  $('inbox-form').onsubmit=async e=>{
    e.preventDefault(); note('inbox-form-note','Membuat tautan…');
    const form=e.target;
    try { const created=await api('/api/inboxes',{method:'POST',body:JSON.stringify({address:form.elements.address.value,label:form.elements.label.value,days:form.elements.days.value})});
      $('created-link-input').value=created.url;show('created-link',true);note('inbox-form-note','Tautan siap. Simpan atau salin sekarang; demi keamanan, kuncinya tidak ditampilkan ulang.');await loadAdmin();
    } catch(error){note('inbox-form-note',error.message,true);}
  };
  $('copy-created-link').onclick=async()=>{await navigator.clipboard.writeText($('created-link-input').value);$('copy-created-link').textContent='Tersalin';};
  $('imap-form').onsubmit=async e=>{
    e.preventDefault();const form=e.target;note('imap-note','Menguji koneksi IMAP…');
    const body={host:form.elements.host.value,port:form.elements.port.value,email:form.elements.email.value,password:form.elements.password.value};
    try{const result=await api('/api/settings/imap',{method:'POST',body:JSON.stringify(body)});form.elements.password.value='';note('imap-note',`Berhasil terhubung. ${result.tested.exists} pesan tersedia di INBOX.`);await loadAdmin();}
    catch(error){note('imap-note',error.message,true);}
  };
  $('test-saved-imap').onclick=async()=>{note('imap-note','Menguji koneksi tersimpan…');try{const result=await api('/api/settings/imap/test',{method:'POST'});note('imap-note',`Berhasil terhubung. ${result.exists} pesan tersedia di INBOX.`);}catch(error){note('imap-note',error.message,true);}};
  $('cloudmail-form').onsubmit=async e=>{
    e.preventDefault();const form=e.target;const body={localLength:form.elements.localLength.value,catchAllConfirmed:form.elements.catchAllConfirmed.checked};
    for (const key of ['autoMailboxUser','keepFailedMailbox','useForSignup','useForRebind']) body[key] = form.elements[key].checked;
    try{const result=await api('/api/provider/settings',{method:'POST',body:JSON.stringify(body)});note('cloudmail-note',result.note);await loadAdmin();}
    catch(error){note('cloudmail-note',error.message,true);}
  };
  $('generate-provider-keys').onclick=async()=>{
    if(!confirm('Buat kunci API baru? Kunci lama akan langsung tidak berlaku.')) return;
    try {
      const result=await api('/api/provider/keys',{method:'POST'});
      $('provider-token').value=result.token; $('provider-password').value=result.password; show('provider-keys',true);
      note('cloudmail-note',result.note); await loadAdmin();
    } catch(error) { note('cloudmail-note',error.message,true); }
  };
  $('copy-provider-keys').onclick=async()=>{
    await navigator.clipboard.writeText(`TOKEN_API_PUBLIK=${$('provider-token').value}\nPASSWORDS=${$('provider-password').value}`);
    $('copy-provider-keys').textContent='Tersalin';
  };
}
