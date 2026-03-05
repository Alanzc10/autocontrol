const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const multer  = require('multer');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ──────────────────────────────────────────
   CONFIGURACIÓN DE ACCESO
   Cambia PASSWORD por tu contraseña personal
────────────────────────────────────────── */
const AUTH = {
  PASSWORD:    '12345',  // ← CAMBIA ESTO
  SESSION_H:   24,
  COOKIE:      'ac_session',
};

/* ──────────────────────────────────────────
   SESIONES (en memoria)
────────────────────────────────────────── */
const sessions = new Map();

function genToken()       { return crypto.randomBytes(48).toString('hex'); }
function getCookie(req, n){ const c = (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(n+'=')); return c ? c.slice(n.length+1) : null; }
function validSession(req){ const t = getCookie(req, AUTH.COOKIE); if(!t||!sessions.has(t)) return false; const s=sessions.get(t); if(Date.now()>s.exp){sessions.delete(t);return false;} return true; }

function requireAuth(req, res, next) {
  if (validSession(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado' });
  res.redirect('/login');
}

setInterval(() => { const n=Date.now(); for(const[k,v] of sessions) if(n>v.exp) sessions.delete(k); }, 3600000);

/* ──────────────────────────────────────────
   MULTER — subida de imágenes
────────────────────────────────────────── */
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename:    (_, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    cb(null, /image\/(jpeg|jpg|png|webp)/.test(file.mimetype));
  }
});

/* ──────────────────────────────────────────
   BASE DE DATOS
────────────────────────────────────────── */
const db = new sqlite3.Database('autos.db', err => {
  if (err) console.error('Error DB:', err.message);
  else     console.log('✅ Base de datos conectada');
});

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS vehiculos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    apodo            TEXT NOT NULL,
    marca            TEXT NOT NULL,
    modelo           TEXT NOT NULL,
    anio             INTEGER,
    placa            TEXT,
    color            TEXT,
    kilometraje      INTEGER DEFAULT 0,
    estado           TEXT DEFAULT 'activo',
    foto             TEXT,
    notas            TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS mantenimientos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vehiculo_id      INTEGER NOT NULL,
    tipo             TEXT NOT NULL,
    fecha            DATE NOT NULL,
    kilometraje      INTEGER,
    proximo_km       INTEGER,
    proximo_fecha    DATE,
    taller           TEXT,
    costo            REAL DEFAULT 0,
    notas            TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reparaciones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vehiculo_id      INTEGER NOT NULL,
    descripcion      TEXT NOT NULL,
    fecha_inicio     DATE NOT NULL,
    fecha_fin        DATE,
    taller           TEXT,
    costo_estimado   REAL DEFAULT 0,
    costo_final      REAL DEFAULT 0,
    estado           TEXT DEFAULT 'en_proceso',
    notas            TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS facturas (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vehiculo_id      INTEGER NOT NULL,
    concepto         TEXT NOT NULL,
    fecha            DATE NOT NULL,
    proveedor        TEXT,
    monto            REAL NOT NULL,
    categoria        TEXT DEFAULT 'repuesto',
    notas            TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS documentos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vehiculo_id      INTEGER NOT NULL,
    tipo             TEXT NOT NULL,
    numero           TEXT,
    fecha_emision    DATE,
    fecha_vencimiento DATE NOT NULL,
    costo            REAL DEFAULT 0,
    notas            TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
  )`);
});

/* ──────────────────────────────────────────
   HELPERS DB
────────────────────────────────────────── */
const dbGet = (sql,p=[]) => new Promise((res,rej) => db.get(sql,p,(e,r)=>e?rej(e):res(r)));
const dbAll = (sql,p=[]) => new Promise((res,rej) => db.all(sql,p,(e,r)=>e?rej(e):res(r)));
const dbRun = (sql,p=[]) => new Promise((res,rej) => db.run(sql,p,function(e){e?rej(e):res(this)}));

/* ──────────────────────────────────────────
   MIDDLEWARE
────────────────────────────────────────── */
app.use(express.json());

const PUBLIC_PATHS = ['/login', '/api/login', '/favicon.ico'];
app.use((req, res, next) => {
  if (PUBLIC_PATHS.includes(req.path) || req.path.match(/\.(css|js|png|jpg|jpeg|webp|ico|woff2?)$/)) return next();
  requireAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

/* ──────────────────────────────────────────
   AUTH ROUTES
────────────────────────────────────────── */
app.get('/login', (req, res) => {
  if (validSession(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  if ((req.body.password||'') !== AUTH.PASSWORD)
    return res.status(401).json({ ok: false });
  const token = genToken();
  sessions.set(token, { exp: Date.now() + AUTH.SESSION_H * 3600000 });
  res.setHeader('Set-Cookie', `${AUTH.COOKIE}=${token}; Path=/; Max-Age=${AUTH.SESSION_H*3600}; HttpOnly; SameSite=Strict`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const t = getCookie(req, AUTH.COOKIE);
  if (t) sessions.delete(t);
  res.setHeader('Set-Cookie', `${AUTH.COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`);
  res.json({ ok: true });
});

/* ──────────────────────────────────────────
   PÁGINAS
────────────────────────────────────────── */
app.get('/',           (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/vehiculo',   (_, res) => res.sendFile(path.join(__dirname, 'public', 'vehiculo.html')));

/* ──────────────────────────────────────────
   API — VEHÍCULOS
────────────────────────────────────────── */
app.get('/api/vehiculos', async (_, res) => {
  try {
    const rows = await dbAll(`
      SELECT v.*,
        (SELECT COUNT(*) FROM mantenimientos WHERE vehiculo_id=v.id)   AS total_mant,
        (SELECT COUNT(*) FROM reparaciones   WHERE vehiculo_id=v.id)   AS total_rep,
        (SELECT COUNT(*) FROM facturas       WHERE vehiculo_id=v.id)   AS total_fact,
        (SELECT COALESCE(SUM(costo),0) FROM mantenimientos WHERE vehiculo_id=v.id)  AS gasto_mant,
        (SELECT COALESCE(SUM(costo_final),0) FROM reparaciones WHERE vehiculo_id=v.id) AS gasto_rep,
        (SELECT COALESCE(SUM(monto),0) FROM facturas WHERE vehiculo_id=v.id)        AS gasto_fact,
        (SELECT tipo||' ('||fecha||')' FROM mantenimientos WHERE vehiculo_id=v.id ORDER BY fecha DESC LIMIT 1) AS ultimo_mant,
        (SELECT MIN(fecha_vencimiento) FROM documentos WHERE vehiculo_id=v.id AND fecha_vencimiento >= date('now')) AS proximo_doc_vence,
        (SELECT tipo FROM documentos WHERE vehiculo_id=v.id AND fecha_vencimiento >= date('now') ORDER BY fecha_vencimiento ASC LIMIT 1) AS proximo_doc_tipo,
        (SELECT proximo_fecha FROM mantenimientos WHERE vehiculo_id=v.id AND proximo_fecha IS NOT NULL ORDER BY proximo_fecha ASC LIMIT 1) AS proximo_mant_fecha,
        (SELECT tipo FROM mantenimientos WHERE vehiculo_id=v.id AND proximo_fecha IS NOT NULL ORDER BY proximo_fecha ASC LIMIT 1) AS proximo_mant_tipo
      FROM vehiculos v
      ORDER BY v.estado ASC, v.apodo ASC
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vehiculos/:id', async (req, res) => {
  try {
    const v = await dbGet(`SELECT * FROM vehiculos WHERE id=?`, [req.params.id]);
    if (!v) return res.status(404).json({ error: 'No encontrado' });
    res.json(v);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vehiculos', upload.single('foto'), async (req, res) => {
  const { apodo, marca, modelo, anio, placa, color, kilometraje, estado, notas } = req.body;
  if (!apodo || !marca || !modelo) return res.status(400).json({ error: 'Apodo, marca y modelo son requeridos' });
  try {
    const foto = req.file ? `/uploads/${req.file.filename}` : null;
    const r = await dbRun(
      `INSERT INTO vehiculos (apodo,marca,modelo,anio,placa,color,kilometraje,estado,foto,notas) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [apodo,marca,modelo,anio||null,placa||'',color||'',kilometraje||0,estado||'activo',foto,notas||'']
    );
    res.json({ id: r.lastID, message: 'Vehículo creado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vehiculos/:id', upload.single('foto'), async (req, res) => {
  const { apodo, marca, modelo, anio, placa, color, kilometraje, estado, notas } = req.body;
  try {
    const actual = await dbGet(`SELECT foto FROM vehiculos WHERE id=?`, [req.params.id]);
    let foto = actual?.foto || null;
    if (req.file) {
      if (foto) { try { fs.unlinkSync(path.join(__dirname,'public',foto)); } catch(e){} }
      foto = `/uploads/${req.file.filename}`;
    }
    await dbRun(
      `UPDATE vehiculos SET apodo=?,marca=?,modelo=?,anio=?,placa=?,color=?,kilometraje=?,estado=?,foto=?,notas=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [apodo,marca,modelo,anio||null,placa||'',color||'',kilometraje||0,estado||'activo',foto,notas||'',req.params.id]
    );
    res.json({ message: 'Vehículo actualizado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vehiculos/:id', async (req, res) => {
  try {
    const v = await dbGet(`SELECT foto FROM vehiculos WHERE id=?`, [req.params.id]);
    if (v?.foto) { try { fs.unlinkSync(path.join(__dirname,'public',v.foto)); } catch(e){} }
    await dbRun(`DELETE FROM vehiculos WHERE id=?`, [req.params.id]);
    res.json({ message: 'Vehículo eliminado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ──────────────────────────────────────────
   API — MANTENIMIENTOS
────────────────────────────────────────── */
app.get('/api/vehiculos/:id/mantenimientos', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM mantenimientos WHERE vehiculo_id=? ORDER BY fecha DESC`, [req.params.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vehiculos/:id/mantenimientos', async (req, res) => {
  const { tipo, fecha, kilometraje, proximo_km, proximo_fecha, taller, costo, notas } = req.body;
  if (!tipo || !fecha) return res.status(400).json({ error: 'Tipo y fecha requeridos' });
  try {
    // Actualizar kilometraje del vehículo si el nuevo es mayor
    if (kilometraje) {
      const v = await dbGet(`SELECT kilometraje FROM vehiculos WHERE id=?`, [req.params.id]);
      if (v && parseInt(kilometraje) > parseInt(v.kilometraje||0))
        await dbRun(`UPDATE vehiculos SET kilometraje=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [kilometraje, req.params.id]);
    }
    const r = await dbRun(
      `INSERT INTO mantenimientos (vehiculo_id,tipo,fecha,kilometraje,proximo_km,proximo_fecha,taller,costo,notas) VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.params.id,tipo,fecha,kilometraje||null,proximo_km||null,proximo_fecha||null,taller||'',parseFloat(costo)||0,notas||'']
    );
    res.json({ id: r.lastID, message: 'Mantenimiento registrado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vehiculos/:id/mantenimientos/:mid', async (req, res) => {
  const { tipo,fecha,kilometraje,proximo_km,proximo_fecha,taller,costo,notas } = req.body;
  try {
    await dbRun(
      `UPDATE mantenimientos SET tipo=?,fecha=?,kilometraje=?,proximo_km=?,proximo_fecha=?,taller=?,costo=?,notas=? WHERE id=? AND vehiculo_id=?`,
      [tipo,fecha,kilometraje||null,proximo_km||null,proximo_fecha||null,taller||'',parseFloat(costo)||0,notas||'',req.params.mid,req.params.id]
    );
    res.json({ message: 'Actualizado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vehiculos/:id/mantenimientos/:mid', async (req, res) => {
  try {
    await dbRun(`DELETE FROM mantenimientos WHERE id=? AND vehiculo_id=?`, [req.params.mid, req.params.id]);
    res.json({ message: 'Eliminado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ──────────────────────────────────────────
   API — REPARACIONES
────────────────────────────────────────── */
app.get('/api/vehiculos/:id/reparaciones', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM reparaciones WHERE vehiculo_id=? ORDER BY fecha_inicio DESC`, [req.params.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vehiculos/:id/reparaciones', async (req, res) => {
  const { descripcion,fecha_inicio,fecha_fin,taller,costo_estimado,costo_final,estado,notas } = req.body;
  if (!descripcion || !fecha_inicio) return res.status(400).json({ error: 'Descripción y fecha requeridas' });
  try {
    const r = await dbRun(
      `INSERT INTO reparaciones (vehiculo_id,descripcion,fecha_inicio,fecha_fin,taller,costo_estimado,costo_final,estado,notas) VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.params.id,descripcion,fecha_inicio,fecha_fin||null,taller||'',parseFloat(costo_estimado)||0,parseFloat(costo_final)||0,estado||'en_proceso',notas||'']
    );
    // Si está en reparación, actualizar estado del vehículo
    if ((estado||'en_proceso') === 'en_proceso') {
      await dbRun(`UPDATE vehiculos SET estado='en_taller',updated_at=CURRENT_TIMESTAMP WHERE id=?`, [req.params.id]);
    }
    res.json({ id: r.lastID, message: 'Reparación registrada' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vehiculos/:id/reparaciones/:rid', async (req, res) => {
  const { descripcion,fecha_inicio,fecha_fin,taller,costo_estimado,costo_final,estado,notas } = req.body;
  try {
    await dbRun(
      `UPDATE reparaciones SET descripcion=?,fecha_inicio=?,fecha_fin=?,taller=?,costo_estimado=?,costo_final=?,estado=?,notas=? WHERE id=? AND vehiculo_id=?`,
      [descripcion,fecha_inicio,fecha_fin||null,taller||'',parseFloat(costo_estimado)||0,parseFloat(costo_final)||0,estado||'en_proceso',notas||'',req.params.rid,req.params.id]
    );
    // Si se marca como terminada y no hay más reparaciones activas, volver a activo
    if (estado === 'terminada') {
      const activas = await dbGet(`SELECT COUNT(*) as c FROM reparaciones WHERE vehiculo_id=? AND estado='en_proceso'`, [req.params.id]);
      if (!activas?.c) await dbRun(`UPDATE vehiculos SET estado='activo',updated_at=CURRENT_TIMESTAMP WHERE id=?`, [req.params.id]);
    }
    res.json({ message: 'Actualizado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vehiculos/:id/reparaciones/:rid', async (req, res) => {
  try {
    await dbRun(`DELETE FROM reparaciones WHERE id=? AND vehiculo_id=?`, [req.params.rid, req.params.id]);
    res.json({ message: 'Eliminado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ──────────────────────────────────────────
   API — FACTURAS
────────────────────────────────────────── */
app.get('/api/vehiculos/:id/facturas', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM facturas WHERE vehiculo_id=? ORDER BY fecha DESC`, [req.params.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vehiculos/:id/facturas', async (req, res) => {
  const { concepto,fecha,proveedor,monto,categoria,notas } = req.body;
  if (!concepto || !fecha || !monto) return res.status(400).json({ error: 'Concepto, fecha y monto requeridos' });
  try {
    const r = await dbRun(
      `INSERT INTO facturas (vehiculo_id,concepto,fecha,proveedor,monto,categoria,notas) VALUES (?,?,?,?,?,?,?)`,
      [req.params.id,concepto,fecha,proveedor||'',parseFloat(monto),categoria||'repuesto',notas||'']
    );
    res.json({ id: r.lastID, message: 'Factura registrada' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vehiculos/:id/facturas/:fid', async (req, res) => {
  const { concepto,fecha,proveedor,monto,categoria,notas } = req.body;
  try {
    await dbRun(
      `UPDATE facturas SET concepto=?,fecha=?,proveedor=?,monto=?,categoria=?,notas=? WHERE id=? AND vehiculo_id=?`,
      [concepto,fecha,proveedor||'',parseFloat(monto),categoria||'repuesto',notas||'',req.params.fid,req.params.id]
    );
    res.json({ message: 'Actualizado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vehiculos/:id/facturas/:fid', async (req, res) => {
  try {
    await dbRun(`DELETE FROM facturas WHERE id=? AND vehiculo_id=?`, [req.params.fid, req.params.id]);
    res.json({ message: 'Eliminado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ──────────────────────────────────────────
   API — DOCUMENTOS
────────────────────────────────────────── */
app.get('/api/vehiculos/:id/documentos', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM documentos WHERE vehiculo_id=? ORDER BY fecha_vencimiento ASC`, [req.params.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vehiculos/:id/documentos', async (req, res) => {
  const { tipo,numero,fecha_emision,fecha_vencimiento,costo,notas } = req.body;
  if (!tipo || !fecha_vencimiento) return res.status(400).json({ error: 'Tipo y fecha de vencimiento requeridos' });
  try {
    const r = await dbRun(
      `INSERT INTO documentos (vehiculo_id,tipo,numero,fecha_emision,fecha_vencimiento,costo,notas) VALUES (?,?,?,?,?,?,?)`,
      [req.params.id,tipo,numero||'',fecha_emision||null,fecha_vencimiento,parseFloat(costo)||0,notas||'']
    );
    res.json({ id: r.lastID, message: 'Documento registrado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vehiculos/:id/documentos/:did', async (req, res) => {
  const { tipo,numero,fecha_emision,fecha_vencimiento,costo,notas } = req.body;
  try {
    await dbRun(
      `UPDATE documentos SET tipo=?,numero=?,fecha_emision=?,fecha_vencimiento=?,costo=?,notas=? WHERE id=? AND vehiculo_id=?`,
      [tipo,numero||'',fecha_emision||null,fecha_vencimiento,parseFloat(costo)||0,notas||'',req.params.did,req.params.id]
    );
    res.json({ message: 'Actualizado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vehiculos/:id/documentos/:did', async (req, res) => {
  try {
    await dbRun(`DELETE FROM documentos WHERE id=? AND vehiculo_id=?`, [req.params.did, req.params.id]);
    res.json({ message: 'Eliminado' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ──────────────────────────────────────────
   API — DASHBOARD GENERAL
────────────────────────────────────────── */
app.get('/api/dashboard', async (_, res) => {
  try {
    const [totales, gastoMes, docsVencer, proxMant] = await Promise.all([
      dbGet(`SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN estado='activo' THEN 1 ELSE 0 END) as activos,
        SUM(CASE WHEN estado='en_taller' THEN 1 ELSE 0 END) as en_taller,
        SUM(CASE WHEN estado='vendido' THEN 1 ELSE 0 END) as vendidos
        FROM vehiculos`),
      dbGet(`SELECT 
        COALESCE(SUM(m.costo),0) + COALESCE(SUM(f.monto),0) as total
        FROM (SELECT costo FROM mantenimientos WHERE strftime('%Y-%m',fecha)=strftime('%Y-%m','now')) m,
             (SELECT monto FROM facturas WHERE strftime('%Y-%m',fecha)=strftime('%Y-%m','now')) f`),
      dbAll(`SELECT d.*, v.apodo, v.placa FROM documentos d 
             JOIN vehiculos v ON v.id=d.vehiculo_id
             WHERE date(d.fecha_vencimiento) <= date('now','+30 days') 
             AND date(d.fecha_vencimiento) >= date('now')
             ORDER BY d.fecha_vencimiento ASC LIMIT 5`),
      dbAll(`SELECT m.*, v.apodo, v.placa FROM mantenimientos m
             JOIN vehiculos v ON v.id=m.vehiculo_id
             WHERE m.proximo_fecha IS NOT NULL AND date(m.proximo_fecha) <= date('now','+30 days')
             ORDER BY m.proximo_fecha ASC LIMIT 5`)
    ]);
    res.json({ totales, gastoMes, docsVencer, proxMant });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ──────────────────────────────────────────
   SERVIDOR
────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(50));
  console.log(`🚗 AutoControl corriendo en http://localhost:${PORT}`);
  console.log('═'.repeat(50) + '\n');
});

process.on('SIGINT', () => {
  db.close(() => { console.log('\n👋 Servidor detenido'); process.exit(0); });
});
