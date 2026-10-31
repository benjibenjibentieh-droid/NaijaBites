'use strict';
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const sql = require('mssql');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';

// Prices are authoritative on the server. Never accept the total or unit prices from the browser.
// Keep this list in sync with the meal catalog in app.js when you change products/prices.
const CATALOG = new Map([
  [1, { name: "Jollof Rice & Grilled Chicken", vendor: "Mama Africa Kitchen", price: 6500 }],
  [2, { name: "Chicken Shawarma", vendor: "Taste Hub", price: 4500 }],
  [3, { name: "Beef Burger & Fries", vendor: "Burger Spot", price: 5800 }],
  [4, { name: "Suya (Beef)", vendor: "Suya Palace", price: 4000 }],
  [5, { name: "Fried Rice & Chicken", vendor: "Royal Kitchen", price: 5200 }],
  [6, { name: "Plantain & Egg Stew", vendor: "Mama's Pot", price: 3900 }],
  [7, { name: "Grilled Fish (Tilapia)", vendor: "Ocean View Grill", price: 7500 }],
  [8, { name: "Egusi Soup & Fufu", vendor: "Naija Food Corner", price: 5900 }],
  [9, { name: "Cappuccino", vendor: "Daily Grind Café", price: 2500 }],
  [10, { name: "Fresh Bread Loaf", vendor: "Sweet Crumbs Bakery", price: 1800 }],
  [11, { name: "Meat Pie", vendor: "Lagos Bakehouse", price: 1200 }],
  [12, { name: "Chocolate Cake Slice", vendor: "Sweet Crumbs Bakery", price: 2200 }],
  [13, { name: "Chicken Shawarma", vendor: "Taste Hub", price: 4500 }],
  [14, { name: "Beef Burger & Fries", vendor: "Burger Spot", price: 5800 }],
  [15, { name: "Chicken Pizza", vendor: "Pizza Corner", price: 7500 }],
  [16, { name: "Jollof Rice & Grilled Chicken", vendor: "Mama Africa Kitchen", price: 6500 }],
  [17, { name: "Fried Rice & Chicken", vendor: "Royal Kitchen", price: 5200 }],
  [18, { name: "Grilled Fish (Tilapia)", vendor: "Ocean View Grill", price: 7500 }],
  [19, { name: "Egusi Soup & Fufu", vendor: "Naija Food Corner", price: 5900 }],
  [20, { name: "Amala, Ewedu & Gbegiri", vendor: "Mama Put Kitchen", price: 3500 }],
  [21, { name: "Beef Suya", vendor: "Suya Palace", price: 4000 }],
  [22, { name: "Local Rice", vendor: "Fresh Basket Store", price: 4200 }],
  [23, { name: "Brown Beans", vendor: "Market Square Provisions", price: 2800 }],
  [24, { name: "Garri", vendor: "Farmgate Foods", price: 1600 }],
  [25, { name: "Palm Oil", vendor: "Fresh Basket Store", price: 3500 }],
  [26, { name: "Live Ram", vendor: "Oke-Aro Livestock Farm", price: 180000 }],
  [27, { name: "Live Cow", vendor: "Idera Cattle Ranch", price: 650000 }],
  [28, { name: "Live Goat", vendor: "Green Pastures Farm", price: 95000 }]
]);

let poolPromise;

function getPool() {
  if (!poolPromise) {
    const config = {
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      server: process.env.SQL_SERVER,
      database: process.env.SQL_DATABASE || 'NaijaBites',
      port: 1433,
      options: {
        encrypt: true,
        trustServerCertificate: false
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      },
      connectionTimeout: 30000,
      requestTimeout: 30000
    };

    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch(err => {
        poolPromise = null;
        throw err;
      });
  }

  return poolPromise;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '30kb' }));
app.use('/api/payments', rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
app.use((req, res, next) => { if (['/server.js', '/schema.sql', '/package.json', '/package-lock.json', '/.env.example', '/README.md', '/INTEGRATION.md'].includes(req.path)) return res.sendStatus(404); next(); });
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

function apiError(res, status, message) { return res.status(status).json({ ok: false, error: message }); }
function validateCustomer(input) {
  const name = String(input?.name || '').trim();
  const email = String(input?.email || '').trim().toLowerCase();
  const phone = String(input?.phone || '').trim();
  if (name.length < 2 || name.length > 120) return { error: 'Enter your name (2–120 characters).' };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (phone.length > 40) return { error: 'Phone number is too long.' };
  return { name, email, phone: phone || null };
}
async function priceCart(inputItems, pool) {
  if (!Array.isArray(inputItems) || inputItems.length < 1 || inputItems.length > 50) return { error: 'Your cart is empty or contains too many lines.' };
  const merged = new Map();
  for (const raw of inputItems) {
    const id = Number(raw?.id), quantity = Number(raw?.quantity);
    if (!Number.isInteger(id)) return { error: 'Your cart contains an invalid item.' };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return { error: 'Each item quantity must be between 1 and 20.' };
    merged.set(id, (merged.get(id) || 0) + quantity);
    if (merged.get(id) > 20) return { error: 'Each item quantity must be 20 or fewer.' };
  }
  const ids = [...merged.keys()];
  const request = new sql.Request(pool);
  ids.forEach((id, i) => request.input(`id${i}`, sql.Int, id));
  const productsResult = await request.query(`SELECT ProductId AS id,ProductName AS name,VendorName AS vendor,PriceNaira AS price FROM dbo.Products WHERE IsActive=1 AND ProductId IN (${ids.map((_, i) => `@id${i}`).join(',')})`);
  const products = new Map(productsResult.recordset.map(p => [p.id, p]));
  if (products.size !== ids.length) return { error: 'Your cart contains an unavailable product. Refresh the marketplace and try again.' };
  const items = [...merged.entries()].map(([id, quantity]) => { const p = products.get(id); return { id, quantity, name: p.name, vendor: p.vendor, price: Number(p.price), lineTotal: Number(p.price) * quantity } });
  const totalNaira = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!Number.isSafeInteger(totalNaira) || totalNaira < 100) return { error: 'The order total is invalid.' };
  return { items, totalNaira, totalKobo: totalNaira * 100 };
}


function cookieValue(req, name) {
  const raw = String(req.headers.cookie || '');
  const found = raw.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}
function setSessionCookie(res, token) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `nb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`);
}
async function currentUserFromRequest(req) {
  const token = cookieValue(req, 'nb_session');
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const pool = await getPool();
  const result = await new sql.Request(pool).input('tokenHash', sql.Char(64), tokenHash)
    .query(`SELECT u.UserId, u.FullName AS name, u.Email AS email, u.Phone AS phone
            FROM dbo.UserSessions s JOIN dbo.Users u ON u.UserId=s.UserId
            WHERE s.TokenHash=@tokenHash AND s.ExpiresAt>SYSUTCDATETIME()`);
  return result.recordset[0] || null;
}
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  try { req.user = await currentUserFromRequest(req); next(); }
  catch (err) { console.error('Session lookup failed:', err.message); apiError(res, 503, 'Database session lookup failed.'); }
});
function requireUser(req, res, next) { if (!req.user) return apiError(res, 401, 'Please sign in to continue.'); next(); }
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(`${salt}:${key.toString('hex')}`));
  });
}
function verifyPassword(password, stored) {
  return new Promise(resolve => {
    const [salt, keyHex] = String(stored || '').split(':');
    if (!salt || !keyHex) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return resolve(false);
      const expected = Buffer.from(keyHex, 'hex');
      resolve(expected.length === key.length && crypto.timingSafeEqual(key, expected));
    });
  });
}
async function createSession(pool, userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await new sql.Request(pool).input('userId', sql.BigInt, userId).input('tokenHash', sql.Char(64), tokenHash)
    .query(`INSERT INTO dbo.UserSessions(UserId,TokenHash,ExpiresAt) VALUES(@userId,@tokenHash,DATEADD(day,7,SYSUTCDATETIME()))`);
  setSessionCookie(res, token);
}
app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body?.name || '').trim(), email = String(req.body?.email || '').trim().toLowerCase();
  const phone = String(req.body?.phone || '').trim(), password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 80) return apiError(res, 400, 'Enter your full name (2–80 characters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return apiError(res, 400, 'Enter a valid email address.');
  if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) return apiError(res, 400, 'Use 8+ characters including uppercase, lowercase, a number and a symbol.');
  try {
    const pool = await getPool(), passwordHash = await hashPassword(password);
    const created = await new sql.Request(pool).input('name', sql.NVarChar(80), name).input('email', sql.NVarChar(254), email).input('phone', sql.NVarChar(40), phone || null).input('passwordHash', sql.VarChar(200), passwordHash)
      .query(`INSERT INTO dbo.Users(FullName,Email,Phone,PasswordHash) OUTPUT INSERTED.UserId VALUES(@name,@email,@phone,@passwordHash)`);
    await createSession(pool, created.recordset[0].UserId, res);
    res.status(201).json({ ok: true, user: { name, email, phone } });
  } catch (err) { if (err.number === 2627 || err.number === 2601) return apiError(res, 409, 'An account with this email already exists.'); console.error('Registration failed:', err.message); apiError(res, 500, 'Could not create your account.'); }
});
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
  try {
    const pool = await getPool(); const result = await new sql.Request(pool).input('email', sql.NVarChar(254), email).query('SELECT UserId,FullName AS name,Email AS email,Phone AS phone,PasswordHash FROM dbo.Users WHERE Email=@email');
    const user = result.recordset[0]; if (!user || !(await verifyPassword(password, user.PasswordHash))) return apiError(res, 401, 'Email or password is incorrect.');
    await createSession(pool, user.UserId, res); delete user.PasswordHash; res.json({ ok: true, user });
  } catch (err) { console.error('Login failed:', err.message); apiError(res, 503, 'Could not sign in. Check the database connection.'); }
});
app.get('/api/auth/me', (req, res) => res.json({ ok: true, user: req.user ? { name: req.user.name, email: req.user.email, phone: req.user.phone || '' } : null }));
app.post('/api/auth/logout', async (req, res) => {
  try { const token = cookieValue(req, 'nb_session'); if (token) { const h = crypto.createHash('sha256').update(token).digest('hex'); const pool = await getPool(); await new sql.Request(pool).input('h', sql.Char(64), h).query('DELETE FROM dbo.UserSessions WHERE TokenHash=@h'); } }
  catch (err) { console.error('Logout session cleanup failed:', err.message) }
  res.setHeader('Set-Cookie', 'nb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); res.json({ ok: true });
});
app.put('/api/auth/profile', requireUser, async (req, res) => {
  const name = String(req.body?.name || '').trim(), email = String(req.body?.email || '').trim().toLowerCase(), phone = String(req.body?.phone || '').trim();
  if (name.length < 2 || ! /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return apiError(res, 400, 'Enter a valid name and email.');
  try { const pool = await getPool(); await new sql.Request(pool).input('id', sql.BigInt, req.user.UserId).input('name', sql.NVarChar(80), name).input('email', sql.NVarChar(254), email).input('phone', sql.NVarChar(40), phone || null).query('UPDATE dbo.Users SET FullName=@name,Email=@email,Phone=@phone,UpdatedAt=SYSUTCDATETIME() WHERE UserId=@id'); res.json({ ok: true, user: { name, email, phone } }) } catch (err) { if (err.number === 2627 || err.number === 2601) return apiError(res, 409, 'That email is already in use.'); apiError(res, 500, 'Could not update profile.') }
});
app.get('/api/products', async (_req, res) => { try { const pool = await getPool(); const r = await new sql.Request(pool).query(`SELECT p.ProductId AS id,p.ProductName AS name,v.CompanyName AS vendor,p.VendorId AS vendorId,p.PriceNaira AS price,p.Category AS category,p.ImageUrl AS image,p.Description AS description,p.UnitLabel AS unit, (SELECT STRING_AGG(CONCAT(l.LocationName,N' — ',l.Address,N', ',l.City),N' | ') FROM dbo.VendorLocations l WHERE l.VendorId=p.VendorId) AS locations FROM dbo.Products p JOIN dbo.Vendors v ON v.VendorId=p.VendorId WHERE p.IsActive=1 AND p.VendorId IS NOT NULL AND NULLIF(LTRIM(RTRIM(p.ImageUrl)),N'') IS NOT NULL ORDER BY p.ProductId`); res.json({ ok: true, products: r.recordset }) } catch (err) { console.error('Product load failed:', err.message); apiError(res, 503, 'Could not load products from SQL Server.') } });
app.get('/api/cart', requireUser, async (req, res) => {
  try {
    const pool = await getPool(); const r = await new sql.Request(pool).input('uid', sql.BigInt, req.user.UserId).query('SELECT c.ProductId AS id,c.Quantity AS quantity,p.PriceNaira AS price,p.ProductName AS name,p.VendorName AS vendor FROM dbo.CartItems c JOIN dbo.Products p ON p.ProductId=c.ProductId WHERE c.UserId=@uid AND p.IsActive=1');
    const cart = {}; for (const row of r.recordset) { cart[row.id] = { id: row.id, price: Number(row.price), quantity: row.quantity, name: row.name, vendor: row.vendor }; } res.json({ ok: true, cart });
  } catch (err) { console.error('Cart load failed:', err.message); apiError(res, 500, 'Could not load your saved cart.') }
});
app.post('/api/cart/items', requireUser, async (req, res) => {
  const id = Number(req.body?.productId), delta = Number(req.body?.quantityDelta); if (!Number.isInteger(id) || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 20) return apiError(res, 400, 'Invalid product or quantity.');
  try { const pool = await getPool(); const active = await new sql.Request(pool).input('pid', sql.Int, id).query('SELECT ProductId FROM dbo.Products WHERE ProductId=@pid AND IsActive=1'); if (!active.recordset.length) return apiError(res, 400, 'That product is unavailable.'); const tx = new sql.Transaction(pool); await tx.begin(); try { const r = await new sql.Request(tx).input('uid', sql.BigInt, req.user.UserId).input('pid', sql.Int, id).query('SELECT Quantity FROM dbo.CartItems WITH (UPDLOCK,HOLDLOCK) WHERE UserId=@uid AND ProductId=@pid'); const next = (r.recordset[0]?.Quantity || 0) + delta; if (next <= 0) { await new sql.Request(tx).input('uid', sql.BigInt, req.user.UserId).input('pid', sql.Int, id).query('DELETE dbo.CartItems WHERE UserId=@uid AND ProductId=@pid') } else { if (next > 20) throw new Error('QUANTITY_LIMIT'); await new sql.Request(tx).input('uid', sql.BigInt, req.user.UserId).input('pid', sql.Int, id).input('q', sql.Int, next).query(`IF EXISTS(SELECT 1 FROM dbo.CartItems WHERE UserId=@uid AND ProductId=@pid) UPDATE dbo.CartItems SET Quantity=@q,UpdatedAt=SYSUTCDATETIME() WHERE UserId=@uid AND ProductId=@pid ELSE INSERT dbo.CartItems(UserId,ProductId,Quantity) VALUES(@uid,@pid,@q)`) } await tx.commit() } catch (err) { await tx.rollback(); if (err.message === 'QUANTITY_LIMIT') return apiError(res, 400, 'Maximum quantity per item is 20.'); throw err } res.json({ ok: true }) } catch (err) { console.error('Cart update failed:', err.message); apiError(res, 500, 'Could not update your saved cart.') }
});
app.delete('/api/cart', requireUser, async (req, res) => { try { const pool = await getPool(); await new sql.Request(pool).input('uid', sql.BigInt, req.user.UserId).query('DELETE dbo.CartItems WHERE UserId=@uid'); res.json({ ok: true }) } catch (err) { apiError(res, 500, 'Could not clear cart.') } });
app.get('/api/orders', requireUser, async (req, res) => { try { const pool = await getPool(); const r = await new sql.Request(pool).input('uid', sql.BigInt, req.user.UserId).query(`SELECT OrderId AS id,CustomerName AS customer,TotalNaira AS total,PaymentStatus AS status,CreatedAt AS createdAt,PaystackReference AS reference FROM dbo.Orders WHERE UserId=@uid ORDER BY CreatedAt DESC`); res.json({ ok: true, orders: r.recordset }) } catch (err) { apiError(res, 500, 'Could not load order history.') } });
app.get('/api/reservations', requireUser, async (req, res) => { try { const pool = await getPool(); const r = await new sql.Request(pool).input('uid', sql.BigInt, req.user.UserId).query('SELECT ReservationId AS id,Restaurant,FullName AS name,Email AS email,Phone AS phone,Guests,ReservationDate AS date,ReservationTime AS time,Notes,Status,CreatedAt AS createdAt FROM dbo.Reservations WHERE UserId=@uid ORDER BY CreatedAt DESC'); res.json({ ok: true, reservations: r.recordset }) } catch (err) { apiError(res, 500, 'Could not load reservations.') } });
app.post('/api/reservations', requireUser, async (req, res) => { const b = req.body || {}; if (!String(b.restaurant || '').trim() || !String(b.date || '') || !String(b.time || '') || !Number.isInteger(Number(b.guests)) || Number(b.guests) < 1 || Number(b.guests) > 30) return apiError(res, 400, 'Complete the reservation details.'); try { const pool = await getPool(); const r = await new sql.Request(pool).input('uid', sql.BigInt, req.user.UserId).input('restaurant', sql.NVarChar(160), String(b.restaurant)).input('name', sql.NVarChar(120), String(b.name || req.user.name)).input('email', sql.NVarChar(254), req.user.email).input('phone', sql.NVarChar(40), String(b.phone || req.user.phone || '')).input('guests', sql.Int, Number(b.guests)).input('date', sql.Date, String(b.date)).input('time', sql.NVarChar(20), String(b.time)).input('notes', sql.NVarChar(1000), String(b.notes || '')).query(`INSERT dbo.Reservations(UserId,Restaurant,FullName,Email,Phone,Guests,ReservationDate,ReservationTime,Notes) OUTPUT INSERTED.ReservationId AS id VALUES(@uid,@restaurant,@name,@email,@phone,@guests,@date,@time,@notes)`); res.status(201).json({ ok: true, id: r.recordset[0].id }) } catch (err) { console.error('Reservation create failed:', err.message); apiError(res, 500, 'Could not save reservation.') } });
app.post('/api/reservations/:id/cancel', requireUser, async (req, res) => { try { const pool = await getPool(); await new sql.Request(pool).input('uid', sql.BigInt, req.user.UserId).input('id', sql.BigInt, req.params.id).query("UPDATE dbo.Reservations SET Status='Cancelled',UpdatedAt=SYSUTCDATETIME() WHERE ReservationId=@id AND UserId=@uid"); res.json({ ok: true }) } catch (err) { apiError(res, 500, 'Could not cancel reservation.') } });


app.get('/api/community/posts', async (_req, res) => { try { const pool = await getPool(); const r = await new sql.Request(pool).query(`SELECT p.PostId AS id,u.FullName AS author,p.PostText AS text,p.Likes AS likes,p.CreatedAt AS createdAt FROM dbo.CommunityPosts p JOIN dbo.Users u ON u.UserId=p.UserId ORDER BY p.CreatedAt DESC`); res.json({ ok: true, posts: r.recordset }) } catch (err) { apiError(res, 503, 'Could not load community posts.') } });
app.post('/api/community/posts', requireUser, async (req, res) => { const text = String(req.body?.text || '').trim(); if (!text || text.length > 2000) return apiError(res, 400, 'Write a post up to 2,000 characters.'); try { const pool = await getPool(); const r = await new sql.Request(pool).input('uid', sql.BigInt, req.user.UserId).input('text', sql.NVarChar(2000), text).query('INSERT dbo.CommunityPosts(UserId,PostText) OUTPUT INSERTED.PostId AS id VALUES(@uid,@text)'); res.status(201).json({ ok: true, id: r.recordset[0].id }) } catch (err) { apiError(res, 500, 'Could not save your post.') } });
app.post('/api/community/posts/:id/like', requireUser, async (req, res) => { try { const pool = await getPool(); await new sql.Request(pool).input('id', sql.BigInt, req.params.id).query('UPDATE dbo.CommunityPosts SET Likes=Likes+1 WHERE PostId=@id'); res.json({ ok: true }) } catch (err) { apiError(res, 500, 'Could not update post.') } });
app.delete('/api/community/posts/:id', requireUser, async (req, res) => { try { const pool = await getPool(); await new sql.Request(pool).input('id', sql.BigInt, req.params.id).input('uid', sql.BigInt, req.user.UserId).query('DELETE dbo.CommunityPosts WHERE PostId=@id AND UserId=@uid'); res.json({ ok: true }) } catch (err) { apiError(res, 500, 'Could not delete post.') } });
app.post('/api/support/messages', async (req, res) => { const name = String(req.body?.name || '').trim(), email = String(req.body?.email || '').trim().toLowerCase(), topic = String(req.body?.topic || '').trim(), message = String(req.body?.message || '').trim(); if (name.length < 2 || ! /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !topic || !message || message.length > 3000) return apiError(res, 400, 'Complete your name, valid email, topic and message.'); try { const pool = await getPool(); await new sql.Request(pool).input('uid', sql.BigInt, req.user?.UserId || null).input('name', sql.NVarChar(120), name).input('email', sql.NVarChar(254), email).input('topic', sql.NVarChar(100), topic).input('message', sql.NVarChar(3000), message).query('INSERT dbo.SupportMessages(UserId,FullName,Email,Topic,Message) VALUES(@uid,@name,@email,@topic,@message)'); res.status(201).json({ ok: true }) } catch (err) { apiError(res, 500, 'Could not save your support message.') } });
app.get('/api/support/messages/mine', requireUser, async (req, res) => { try { const pool = await getPool(); const r = await new sql.Request(pool).input('uid', sql.BigInt, req.user.UserId).query('SELECT SupportMessageId AS id,FullName AS name,Email AS email,Topic AS topic,Message AS message,Status AS status,CreatedAt AS createdAt FROM dbo.SupportMessages WHERE UserId=@uid ORDER BY CreatedAt DESC'); res.json({ ok: true, messages: r.recordset }) } catch (err) { apiError(res, 500, 'Could not load support messages.') } });

// Vendor authentication is separate from customer accounts.
function vendorCookie(req) { return cookieValue(req, 'nb_vendor_session') }
async function requireVendor(req, res, next) {
  try {
    const token = vendorCookie(req); if (!token) return apiError(res, 401, 'Please sign in to your vendor account.');
    const hash = crypto.createHash('sha256').update(token).digest('hex'), pool = await getPool();
    const r = await new sql.Request(pool).input('hash', sql.Char(64), hash).query(`SELECT v.VendorId AS id,v.CompanyName AS companyName,v.ContactName AS contactName,v.Email AS email,v.Phone AS phone FROM dbo.VendorSessions s JOIN dbo.Vendors v ON v.VendorId=s.VendorId WHERE s.TokenHash=@hash AND s.ExpiresAt>SYSUTCDATETIME()`);
    if (!r.recordset.length) return apiError(res, 401, 'Vendor session expired. Please sign in again.'); req.vendor = r.recordset[0]; next();
  } catch (e) { console.error('Vendor session failed:', e.message); apiError(res, 503, 'Could not validate vendor session.') }
}
async function createVendorSession(pool, vendorId, res) { const token = crypto.randomBytes(32).toString('hex'), hash = crypto.createHash('sha256').update(token).digest('hex'); await new sql.Request(pool).input('id', sql.BigInt, vendorId).input('hash', sql.Char(64), hash).query(`INSERT dbo.VendorSessions(VendorId,TokenHash,ExpiresAt) VALUES(@id,@hash,DATEADD(day,7,SYSUTCDATETIME()))`); const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''; res.setHeader('Set-Cookie', `nb_vendor_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`) }
function imgixUrl(value) { try { const u = new URL(String(value || '')); const allowed = process.env.IMGIX_DOMAIN ? u.hostname.toLowerCase() === process.env.IMGIX_DOMAIN.toLowerCase() : u.hostname.endsWith('.imgix.net'); return u.protocol === 'https:' && allowed && u.username === '' && u.password === '' ? u.toString() : null } catch { return null } }
app.post('/api/vendor/register', (_req, res) => {
  return apiError(res, 403, 'Vendor accounts are created by the NaijaBites team. Email sellersupport@naijabites.com to request access.');
});
app.post('/api/vendor/login', async (req, res) => { try { const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || ''), pool = await getPool(); const r = await new sql.Request(pool).input('email', sql.NVarChar(254), email).query('SELECT VendorId AS id,CompanyName AS companyName,ContactName AS contactName,Email AS email,Phone AS phone,PasswordHash FROM dbo.Vendors WHERE Email=@email'); const v = r.recordset[0]; if (!v || !(await verifyPassword(password, v.PasswordHash))) return apiError(res, 401, 'Email or password is incorrect.'); delete v.PasswordHash; await createVendorSession(pool, v.id, res); res.json({ ok: true, vendor: v }) } catch (e) { console.error('Vendor login failed:', e.message); apiError(res, 503, 'Could not sign in to vendor account.') } });
app.post('/api/vendor/logout', async (req, res) => { try { const t = vendorCookie(req); if (t) { const h = crypto.createHash('sha256').update(t).digest('hex'), pool = await getPool(); await new sql.Request(pool).input('hash', sql.Char(64), h).query('DELETE dbo.VendorSessions WHERE TokenHash=@hash') } } catch (e) { } res.setHeader('Set-Cookie', 'nb_vendor_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); res.json({ ok: true }) });
app.get('/api/vendor/me', requireVendor, (req, res) => res.json({ ok: true, vendor: req.vendor }));
app.get('/api/vendor/dashboard', requireVendor, async (req, res) => { try { const pool = await getPool(); const [products, locations] = await Promise.all([new sql.Request(pool).input('id', sql.BigInt, req.vendor.id).query('SELECT ProductId AS id,ProductName AS name,PriceNaira AS price,Category AS category,ImageUrl AS image,Description AS description,IsActive AS active FROM dbo.Products WHERE VendorId=@id ORDER BY CreatedAt DESC'), new sql.Request(pool).input('id', sql.BigInt, req.vendor.id).query('SELECT LocationId AS id,LocationName AS name,Address AS address,City AS city,State AS state,Phone AS phone FROM dbo.VendorLocations WHERE VendorId=@id ORDER BY LocationId DESC')]); res.json({ ok: true, products: products.recordset, locations: locations.recordset }) } catch (e) { console.error('Vendor dashboard failed:', e.message); apiError(res, 500, 'Could not load vendor dashboard.') } });
app.post('/api/vendor/locations', requireVendor, async (req, res) => { const b = req.body || {}, name = String(b.name || '').trim(), address = String(b.address || '').trim(), city = String(b.city || '').trim(), state = String(b.state || 'Lagos').trim(), phone = String(b.phone || '').trim(); if (name.length < 2 || address.length < 4 || city.length < 2) return apiError(res, 400, 'Enter location name, full address and city.'); try { const pool = await getPool(); const r = await new sql.Request(pool).input('id', sql.BigInt, req.vendor.id).input('name', sql.NVarChar(120), name).input('address', sql.NVarChar(300), address).input('city', sql.NVarChar(100), city).input('state', sql.NVarChar(100), state || 'Lagos').input('phone', sql.NVarChar(40), phone || null).query('INSERT dbo.VendorLocations(VendorId,LocationName,Address,City,State,Phone) OUTPUT INSERTED.LocationId AS id VALUES(@id,@name,@address,@city,@state,@phone)'); res.status(201).json({ ok: true, id: r.recordset[0].id }) } catch (e) { apiError(res, 500, 'Could not save location.') } });
app.delete('/api/vendor/locations/:id', requireVendor, async (req, res) => { try { const pool = await getPool(); await new sql.Request(pool).input('id', sql.BigInt, req.params.id).input('vendor', sql.BigInt, req.vendor.id).query('DELETE dbo.VendorLocations WHERE LocationId=@id AND VendorId=@vendor'); res.json({ ok: true }) } catch (e) { apiError(res, 500, 'Could not delete location.') } });
app.post('/api/vendor/products', requireVendor, async (req, res) => { const b = req.body || {}, name = String(b.name || '').trim(), category = String(b.category || 'dining').trim().toLowerCase(), description = String(b.description || '').trim(), image = imgixUrl(b.image), price = Number(b.price), unit = String(b.unit || 'plate').trim(); if (name.length < 2 || name.length > 160) return apiError(res, 400, 'Enter a meal name.'); if (!['fastfood', 'dining', 'buka', 'cafe', 'groceries', 'livestock'].includes(category)) return apiError(res, 400, 'Choose a valid marketplace category.'); if (!Number.isFinite(price) || price < 100 || price > 100000000) return apiError(res, 400, 'Enter a valid price in naira.'); if (!image) return apiError(res, 400, process.env.IMGIX_DOMAIN ? 'Use an HTTPS image URL from your configured Imgix domain.' : 'Use an HTTPS image URL from your *.imgix.net source.'); if (description.length > 1000) return apiError(res, 400, 'Description must be under 1,000 characters.'); try { const pool = await getPool(); const tx = new sql.Transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); try { const idResult = await new sql.Request(tx).query('SELECT ISNULL(MAX(ProductId),0)+1 AS nextId FROM dbo.Products WITH (TABLOCKX,HOLDLOCK)'); const id = idResult.recordset[0].nextId; await new sql.Request(tx).input('id', sql.Int, id).input('vendorId', sql.BigInt, req.vendor.id).input('name', sql.NVarChar(160), name).input('vendor', sql.NVarChar(160), req.vendor.companyName).input('price', sql.Decimal(12, 2), price).input('category', sql.NVarChar(40), category).input('image', sql.NVarChar(500), image).input('description', sql.NVarChar(1000), description).input('unit', sql.NVarChar(40), unit).query('INSERT dbo.Products(ProductId,ProductName,VendorName,PriceNaira,VendorId,Category,ImageUrl,Description,UnitLabel,IsActive) VALUES(@id,@name,@vendor,@price,@vendorId,@category,@image,@description,@unit,1)'); await tx.commit(); res.status(201).json({ ok: true, id }) } catch (e) { await tx.rollback(); throw e } } catch (e) { console.error('Vendor product create failed:', e.message); apiError(res, 500, 'Could not publish meal.') } });
app.patch('/api/vendor/products/:id', requireVendor, async (req, res) => { const active = req.body?.active === true; try { const pool = await getPool(); await new sql.Request(pool).input('id', sql.Int, req.params.id).input('vendor', sql.BigInt, req.vendor.id).input('active', sql.Bit, active).query('UPDATE dbo.Products SET IsActive=@active,UpdatedAt=SYSUTCDATETIME() WHERE ProductId=@id AND VendorId=@vendor'); res.json({ ok: true }) } catch (e) { apiError(res, 500, 'Could not update meal.') } });

app.get('/api/health', async (_req, res) => {
  try {
    await getPool();
    res.json({ ok: true, database: 'connected', paymentMode: 'test' });
  } catch (err) {
    console.error('Health check SQL error:', err.message);
    apiError(res, 503, 'Cannot connect to SQL Server. Check .env, SQL Server service, ODBC driver, and Windows login permissions.');
  }
});

app.post('/api/payments/initialize', async (req, res) => {
  if (!PAYSTACK_SECRET_KEY.startsWith('sk_test_')) return apiError(res, 503, 'Paystack test key is missing or is not a test secret. Set PAYSTACK_SECRET_KEY in .env to an sk_test_ key.');
  if (!req.user) return apiError(res, 401, 'Please sign in before checkout.');
  const customer = validateCustomer({ name: req.user.name, email: req.user.email, phone: req.user.phone });
  if (customer.error) return apiError(res, 400, customer.error);
  let cartRows;
  try { const cp = await getPool(); const cr = await new sql.Request(cp).input('uid', sql.BigInt, req.user.UserId).query('SELECT ProductId AS id, Quantity AS quantity FROM dbo.CartItems WHERE UserId=@uid'); cartRows = cr.recordset; } catch (e) { return apiError(res, 500, 'Could not load your database cart.'); }
  const priced = await priceCart(cartRows, await getPool());
  if (priced.error) return apiError(res, 400, priced.error);

  let pool;
  let orderId;
  const reference = `NB-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  try {
    pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const orderInsert = await new sql.Request(tx)
        .input('name', sql.NVarChar(120), customer.name)
        .input('email', sql.NVarChar(254), customer.email)
        .input('phone', sql.NVarChar(40), customer.phone)
        .input('total', sql.Decimal(12, 2), priced.totalNaira)
        .input('userId', sql.BigInt, req.user.UserId)
        .input('reference', sql.VarChar(100), reference)
        .query(`INSERT INTO dbo.Orders (UserId, CustomerName, CustomerEmail, CustomerPhone, TotalNaira, PaymentStatus, OrderStatus, PaystackReference)
                OUTPUT INSERTED.OrderId VALUES (@userId, @name, @email, @phone, @total, 'Pending', 'AwaitingPayment', @reference);`);
      orderId = orderInsert.recordset[0].OrderId;
      for (const item of priced.items) {
        await new sql.Request(tx)
          .input('orderId', sql.BigInt, orderId)
          .input('productId', sql.Int, item.id)
          .input('productName', sql.NVarChar(160), item.name)
          .input('vendor', sql.NVarChar(160), item.vendor)
          .input('price', sql.Decimal(12, 2), item.price)
          .input('quantity', sql.Int, item.quantity)
          .input('lineTotal', sql.Decimal(12, 2), item.lineTotal)
          .query(`INSERT INTO dbo.OrderItems (OrderId, ProductId, ProductName, VendorName, UnitPriceNaira, Quantity, LineTotalNaira)
                  VALUES (@orderId, @productId, @productName, @vendor, @price, @quantity, @lineTotal);`);
      }
      await new sql.Request(tx)
        .input('orderId', sql.BigInt, orderId)
        .input('reference', sql.VarChar(100), reference)
        .input('amountKobo', sql.BigInt, priced.totalKobo)
        .query(`INSERT INTO dbo.PaymentTransactions (OrderId, PaystackReference, AmountKobo, Currency, Status)
                VALUES (@orderId, @reference, @amountKobo, 'NGN', 'Initializing');`);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: customer.email,
        amount: String(priced.totalKobo),
        currency: 'NGN',
        reference,
        callback_url: `${BASE_URL}/payment-callback.html`,
        metadata: { order_id: String(orderId), customer_name: customer.name, custom_fields: [{ display_name: 'NaijaBites Order', variable_name: 'order_id', value: String(orderId) }] }
      })
    });
    const gateway = await paystackResponse.json().catch(() => ({}));
    if (!paystackResponse.ok || !gateway.status || !gateway.data?.authorization_url) {
      await new sql.Request(pool).input('reference', sql.VarChar(100), reference)
        .query(`UPDATE dbo.Orders SET PaymentStatus='InitializationFailed' WHERE PaystackReference=@reference;
                UPDATE dbo.PaymentTransactions SET Status='InitializationFailed', GatewayMessage='Paystack initialization failed' WHERE PaystackReference=@reference;`);
      console.error('Paystack initialize rejected:', gateway.message || paystackResponse.status);
      return apiError(res, 502, 'Paystack could not start checkout. Your order has not been paid. Please try again.');
    }
    await new sql.Request(pool).input('reference', sql.VarChar(100), reference)
      .query(`UPDATE dbo.PaymentTransactions SET Status='Initialized', GatewayMessage='Authorization URL created' WHERE PaystackReference=@reference;`);
    res.json({ ok: true, authorization_url: gateway.data.authorization_url, reference, orderId: String(orderId), totalNaira: priced.totalNaira });
  } catch (err) {
    console.error('Payment initialization error:', err.message);
    if (orderId && pool) {
      try { await new sql.Request(pool).input('reference', sql.VarChar(100), reference).query("UPDATE dbo.Orders SET PaymentStatus='InitializationFailed' WHERE PaystackReference=@reference"); } catch { }
    }
    apiError(res, 500, 'Could not prepare checkout. Confirm SQL Server is running and the schema.sql script has been applied.');
  }
});

app.get('/api/payments/verify', async (req, res) => {
  const reference = String(req.query.reference || '').trim();
  if (!reference || reference.length > 100 || !/^[A-Za-z0-9.=_-]+$/.test(reference)) return apiError(res, 400, 'A valid payment reference is required.');
  if (!PAYSTACK_SECRET_KEY.startsWith('sk_test_')) return apiError(res, 503, 'Paystack test key is not configured.');
  try {
    const pool = await getPool();
    const found = await new sql.Request(pool).input('reference', sql.VarChar(100), reference)
      .query(`SELECT TOP 1 OrderId, TotalNaira, CustomerName, PaymentStatus FROM dbo.Orders WHERE PaystackReference=@reference;`);
    if (!found.recordset.length) return apiError(res, 404, 'No NaijaBites order was found for this payment reference.');
    const order = found.recordset[0];
    const gatewayResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
    });
    const gateway = await gatewayResponse.json().catch(() => ({}));
    const data = gateway.data;
    const expectedKobo = Math.round(Number(order.TotalNaira) * 100);
    const paid = gatewayResponse.ok && gateway.status === true && data && data.status === 'success'
      && data.reference === reference && Number(data.amount) === expectedKobo && data.currency === 'NGN'
      && String(data.metadata?.order_id || '') === String(order.OrderId);

    if (paid) {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        await new sql.Request(tx)
          .input('reference', sql.VarChar(100), reference)
          .input('transactionId', sql.VarChar(40), String(data.id))
          .query(`UPDATE dbo.Orders SET PaymentStatus='Paid', OrderStatus='Confirmed', PaystackTransactionId=@transactionId, PaidAt=COALESCE(PaidAt, SYSUTCDATETIME())
                  WHERE PaystackReference=@reference AND PaymentStatus <> 'Paid';
                  UPDATE dbo.PaymentTransactions SET Status='Success', PaystackTransactionId=@transactionId, GatewayMessage='Verified successfully', VerifiedAt=SYSUTCDATETIME()
                  WHERE PaystackReference=@reference;
                  DELETE dbo.CartItems WHERE UserId=(SELECT UserId FROM dbo.Orders WHERE PaystackReference=@reference);`);
        await tx.commit();
      } catch (err) { await tx.rollback(); throw err; }
      return res.json({ ok: true, paid: true, reference, orderId: String(order.OrderId), customerName: order.CustomerName, totalNaira: Number(order.TotalNaira), message: 'Payment verified successfully.' });
    }

    const isFailed = data && ['failed', 'abandoned'].includes(String(data.status).toLowerCase());
    if (isFailed) {
      await new sql.Request(pool).input('reference', sql.VarChar(100), reference)
        .query(`UPDATE dbo.Orders SET PaymentStatus='Failed' WHERE PaystackReference=@reference AND PaymentStatus <> 'Paid';
                UPDATE dbo.PaymentTransactions SET Status='Failed', GatewayMessage='Gateway reported failed/abandoned', VerifiedAt=SYSUTCDATETIME() WHERE PaystackReference=@reference;`);
    }
    return res.status(402).json({ ok: true, paid: false, reference, message: 'Payment has not been verified as successful. If you just paid, wait a moment and retry verification.' });
  } catch (err) {
    console.error('Payment verification error:', err.message);
    apiError(res, 500, 'Could not verify payment right now. Please retry in a moment.');
  }
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled request error:', err.message);
  apiError(res, 500, 'Unexpected server error.');
});

app.listen(PORT, () => {
  console.log(`NaijaBites running at ${BASE_URL}`);
  console.log(`Paystack mode: ${PAYSTACK_SECRET_KEY.startsWith('sk_test_') ? 'TEST' : 'NOT CONFIGURED (test key required)'}`);
  console.log(`SQL Server: ${process.env.SQL_SERVER || 'localhost'}${process.env.SQL_INSTANCE ? '\\' + process.env.SQL_INSTANCE : ''} / ${process.env.SQL_DATABASE || 'NaijaBites'} (Windows Authentication)`);
});
