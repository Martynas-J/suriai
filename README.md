# Pieno gaminiai — užsakymų svetainė

Vercel + MariaDB aplikacija, skirta priimti ir valdyti naminio ūkio pieno gaminių užsakymus.

## Struktūra

```
/
├── index.html            ← Pagrindinis puslapis (užsakymo forma + produktai)
├── app.js                ← Front-end logika (fetch į API)
├── admin.html            ← Admin prisijungimo + užsakymų valdymas
├── admin.js              ← Admin logika
├── stats.html            ← Statistikos puslapis
├── stats.js              ← Statistikos logika
├── styles.css, redesign.css, admin.css, menu-cta.css,
│   dashboard.css, dashboard-nav.css, admin-extras.css
├── lib/
│   ├── db.js             ← MariaDB prisijungimo pool
│   └── auth.js           ← Sesijos tokeno (HMAC-SHA256) tikrinimas
├── api/                  ← Vercel serverless funkcijos
│   ├── auth.js           ← POST /api/auth (vartotojo prisijungimas)
│   ├── products.js       ← GET /api/products
│   ├── orders.js         ← GET/POST /api/orders
│   ├── orders/[id].js    ← PATCH/DELETE /api/orders/[id]
│   ├── users.js          ← GET/POST /api/users (tik super_admin)
│   └── users/[id].js     ← PATCH/DELETE /api/users/[id] (tik super_admin)
├── package.json
└── vercel.json
```

## Aplinkos kintamieji (Vercel Project → Settings → Environment Variables)

| Kintamasis | Privalomas | Paskirtis |
|---|---|---|
| `DB_HOST` | ✅ | MariaDB host'as |
| `DB_PORT` | ✅ | MariaDB portas (pvz. `3306`) |
| `DB_USER` | ✅ | DB vartotojas (rekomenduojamas ne-`root`) |
| `DB_PASSWORD` | ✅ | DB slaptažodis |
| `DB_NAME` | ✅ | Duomenų bazė (pvz. `Suriai`) |
| `SESSION_SECRET` | ✅ | Token'o HMAC-SHA256 pasirašymo raktas. **Būtinas, 32+ simbolių atsitiktinė eilutė.** Generuok: `openssl rand -hex 32` |

> **SVARBU:** Env failų **NĖRA** šiame repo dėl saugumo. Visas reikšmes tiesiogiai įrašykite Vercel konsole.

## Duomenų bazė

MariaDB (>=10.5) su `utf8mb4` ir `utf8mb4_lithuanian_ci` koduote.

### Lentelės

- `products` — produktų katalogas
- `orders` — užsakymai
- `order_items` — užsakymo eilutės (FK → orders, products, ON DELETE CASCADE)
- `users` — admin vartotojai (`username`, `display_name`, `password_hash`, `role`)
- `settings` — `session_secret` (atsarginis, jei nenurodytas `SESSION_SECRET` env)

### Pirmojo vartotojo sukūrimas

```sql
-- DB seed'inimo SQL pavyzdys (Vercel pirmiausia pasiekia duomenų bazę)
INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, 'super_admin');
```

Slaptažodžio hash generuojamas su **scrypt** (`salt:hash` formatu, 64 baitų hex). Pvz. Node.js:

```js
const { randomBytes, scryptSync } = require('node:crypto');
const salt = randomBytes(16).toString('hex');
const hash = scryptSync('tavo-slaptazodis', salt, 64).toString('hex');
console.log(`${salt}:${hash}`);
```

Arba naudokitės admin sąsaja: super admin'as gali sukurti papildomus vartotojus per „Vartotojai" skiltį (po pirmo prisijungimo).

## Diegimas

1. Įkelkite kodą į Vercel (GitHub import arba `vercel deploy`).
2. Projekto nustatymuose pridėkite 6 aukščiau nurodytus kintamuosius.
3. `vercel deploy --prod` arba automatinis deploy iš GitHub.
4. Sukurkite pirmą `super_admin` vartotoją DB (žr. aukščiau).

## API

Viešas:
- `GET /api/products` — produktų sąrašas
- `POST /api/orders` — pateikti užsakymą
- `POST /api/auth` — prisijungimas (grąžina tokeną)

Reikalauja admin token (`Authorization: Bearer <token>`):
- `GET /api/orders` — užsakymų sąrašas
- `PATCH /api/orders/[id]` — keisti būseną
- `DELETE /api/orders/[id]` — ištrinti užsakymą

Reikalauja **super_admin** rolės:
- `GET /api/users` — vartotojų sąrašas
- `POST /api/users` — sukurti vartotoją
- `PATCH /api/users/[id]` — keisti rolę/slaptažodį
- `DELETE /api/users/[id]` — ištrinti vartotoją
