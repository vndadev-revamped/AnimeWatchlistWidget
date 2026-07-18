# Guía Completa: Widgets de Discord Automatizados

> Cómo pasamos de apps locales con dependencias a scripts zero-dependency que se ejecutan solos en GitHub Actions — Steam, Spotify, y Anime Watchlist.

---

## Índice

1. [El patrón: de script local a GitHub Actions](#1-el-patrón-de-script-local-a-github-actions)
2. [El PATCH mágico: cómo funciona el widget de Discord](#2-el-patch-mágico-cómo-funciona-el-widget-de-discord)
3. [El error 50025 y la solución](#3-el-error-50025-y-la-solución)
4. [GitHub Actions: secrets y cron](#4-github-actions-secrets-y-cron)
5. [Proyecto 1: Steam Widget](#5-proyecto-1-steam-widget)
6. [Proyecto 2: Spotify Widget](#6-proyecto-2-spotify-widget)
   - [Cómo obtener el refresh token de Spotify (PKCE)](#cómo-obtener-el-refresh-token-de-spotify-pkce)
7. [Proyecto 3: Anime Watchlist Widget](#7-proyecto-3-anime-watchlist-widget)
   - [AniList GraphQL explicado](#anilist-graphql-explicado)
8. [Widget layouts: cómo se arman](#8-widget-layouts-cómo-se-arman)
9. [Créditos](#9-créditos)
10. [Checklist final para cada widget](#10-checklist-final-para-cada-widget)

---

## 1. El patrón: de script local a GitHub Actions

Los tres proyectos originales compartían el mismo problema: eran apps locales que necesitaban estar corriendo para funcionar.

| Proyecto | Original | Ahora |
|---|---|---|
| **Steam** | TypeScript + `axios` + `node-persist` + `start.bat` | `steam-widget.js` (vanilla JS) + GitHub Actions |
| **Spotify** | TypeScript + `axios` + `node-persist` + OAuth PKCE interactivo | `spotify-widget.js` + refresh token + GitHub Actions |
| **Anime Watchlist** | TypeScript + `axios` + `dotenv` + `tsx` + `start.bat` | `sync.js` + AniList GraphQL + GitHub Actions |

### El patrón en 4 pasos

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  GitHub       │     │  Script       │     │  API          │     │  Discord      │
│  Actions      │────▶│  vanilla JS   │────▶│  externa      │────▶│  Widget       │
│  (cron 00:00) │     │  (fetch nativo)│    │  (datos reales)│    │  (PATCH)      │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

1. GitHub Actions despierta al script cada día
2. El script consulta una API externa con datos reales del usuario
3. Procesa los datos y arma un payload JSON
4. Hace un `PATCH` a Discord para actualizar el widget

### Dependencias: de 3 a 0

| Original | Ahora |
|---|---|
| `axios` (HTTP) | `fetch()` nativo de Node 22 |
| `dotenv` (variables de entorno) | `process.env` + GitHub Secrets |
| `tsx` (TypeScript runtime) | JavaScript vanilla |
| `node-persist` (almacenamiento local) | GitHub Secrets para tokens |

**Sin `package.json`, sin `node_modules`, sin `npm install`.** Solo un archivo `.js`.

---

## 2. El PATCH mágico: cómo funciona el widget de Discord

El endpoint clave es uno solo:

```
PATCH https://discord.com/api/v10/applications/{APP_ID}/users/{USER_ID}/identities/0/profile
```

**Headers necesarios:**
```
Authorization: Bot {DISCORD_TOKEN}
Content-Type: application/json
```

**Body de ejemplo (Steam):**
```json
{
  "username": "vandacortee",
  "data": {
    "dynamic": [
      { "type": 1, "name": "display_name", "value": "vndadev" },
      { "type": 2, "name": "owned_games", "value": 156 },
      { "type": 1, "name": "most_played", "value": "CS2" }
    ]
  }
}
```

**Tipos de datos en el payload:**

| `type` | Significado | Ejemplo |
|---|---|---|
| `1` | Texto | `"Frieren"` |
| `2` | Número | `156` |
| `3` | Objeto/URL | `{ "url": "https://..." }` |

El `name` de cada campo debe coincidir **exactamente** con el `value` del `widget-layout.json`. Por ejemplo, si el layout dice `"value": "owned_games"`, el payload debe tener `"name": "owned_games"`.

---

## 3. El error 50025 y la solución

Este error apareció en **Spotify y Anime** y es el más frustrante:

```
Discord API 403: {"message": "Invalid OAuth2 access token", "code": 50025}
```

### Causa

La app de Discord **debe ser creada desde la extensión Widget Creator** usando el botón "Create new widget". Si la app se crea manualmente en el [Discord Developer Portal](https://discord.com/developers/applications), el identity del widget no se inicializa correctamente y el bot token no puede hacer PATCH.

### Solución

1. Abrir la extensión **Widget Creator** en Discord
2. Hacer clic en **"Create new widget"**
3. Importar el `widget-layout.json` en esa app nueva
4. Copiar el nuevo **Application ID** y **Bot Token** a los secrets de GitHub
5. **Importante:** Cada widget necesita su propia app separada

> ⚠️ Si tienes varias apps en el Developer Portal, elige bien cuál es la del widget. La extensión lista tus apps en un dropdown.

---

## 4. GitHub Actions: secrets y cron

### Workflow base (igual para los 3 widgets)

```yaml
name: Update Widget
on:
  schedule:
    - cron: "0 0 */1 * *"   # todos los días a las 00:00 UTC
  workflow_dispatch:          # trigger manual desde el botón

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Run script
        run: node script.js
        env:
          SECRET_NAME: ${{ secrets.SECRET_NAME }}
```

### Secrets comunes a los 3 widgets

| Secret | Uso |
|---|---|
| `DISCORD_TOKEN` | Bot token de la app del widget |
| `DISCORD_APPLICATION_ID` | ID de la app de Discord |
| `DISCORD_USER_ID` | Tu ID numérico de Discord |

### Secrets específicos

| Widget | Secrets extra |
|---|---|
| Steam | `STEAM_API_KEY`, `STEAM_ID` |
| Spotify | `SPOTIFY_CLIENT_ID`, `SPOTIFY_REFRESH_TOKEN` |
| Anime | `ANILIST_USERNAME` |

### Dónde ponerlos

`https://github.com/TU_USUARIO/TU_REPO/settings/secrets/actions` → **New repository secret**

---

## 5. Proyecto 1: Steam Widget

**Repo:** [`vndadev-revamped/SteamWidgetUpdater`](https://github.com/vndadev-revamped/SteamWidgetUpdater)
**Autor original:** ItsDenji777

### API usada

Steam Web API con `STEAM_API_KEY`. Endpoints:

| Endpoint | Datos que da |
|---|---|
| `ISteamUser/GetPlayerSummaries` | Nombre, avatar, tiempo de creación |
| `IPlayerService/GetOwnedGames` | Total de juegos, playtime total |
| `IPlayerService/GetRecentlyPlayedGames` | Playtime últimas 2 semanas |
| `IPlayerService/GetSteamLevel` | Nivel de Steam |
| `ISteamUser/GetFriendList` | Cantidad de amigos |
| `IPlayerService/GetBadges` | Cantidad de insignias |

### Cómo obtener la Steam API Key

1. Ve a <https://steamcommunity.com/dev/apikey>
2. Inicia sesión con tu cuenta de Steam
3. Acepta los términos
4. Copia la key generada

### Cómo obtener tu Steam ID

Tu Steam ID numérico (STEAM_64). Si solo conoces tu nombre de perfil:
1. Ve a <https://steamid.io/>
2. Pega tu URL de perfil
3. Copia el `steamID64` (formato `7656119XXXXXXXXXX`)

---

## 6. Proyecto 2: Spotify Widget

**Repo:** [`vndadev-revamped/SpotifyWidgetUpdater`](https://github.com/vndadev-revamped/SpotifyWidgetUpdater)
**Autor original:** Blankiiii

### API usada

Spotify Web API con OAuth 2.0. Endpoints:

| Endpoint | Datos |
|---|---|
| `me` | Nombre, avatar, seguidores |
| `me/playlists` | Cantidad de playlists públicas |
| `me/top/artists` (short/long term) | Artista favorito, heavy rotation |
| `me/top/tracks` (short/long term) | Obsesión actual, canción de tu vida |
| `me/player/recently-played` | Minutos escuchados en 24h |
| `me/tracks` | Tamaño de tu biblioteca |

### Diferencia clave: necesita refresh token

A diferencia de Steam y AniList, Spotify **no acepta API keys simples**. Requiere OAuth 2.0 con PKCE. La solución fue:

1. Obtener un refresh token **una sola vez** usando el script `get-refresh-token.js`
2. Guardar ese refresh token como secret en GitHub
3. El script diario intercambia el refresh token por un access token (válido 1 hora)

### Cómo obtener el refresh token de Spotify (PKCE)

**Paso 1: Crear una app en Spotify Dashboard**

1. Ve a <https://developer.spotify.com/dashboard>
2. Crea una app (nombre cualquiera)
3. Copia el **Client ID**
4. Ve a Settings → Redirect URIs → agrega `http://localhost:8888/callback`
5. Guarda

**Paso 2: Ejecutar el script local**

```bash
node get-refresh-token.js
```

El script:
1. Abre tu navegador en la página de login de Spotify
2. Tú autorizas la app
3. Spotify redirige a `localhost:8888/callback`
4. El script captura el código e intercambia por un refresh token
5. Imprime el refresh token en consola

**Paso 3: Guardar el refresh token**

Copia el refresh token y pégalo en el secret `SPOTIFY_REFRESH_TOKEN` de GitHub.

> ⚠️ El refresh token **no expira** a menos que revoques el acceso manualmente. Guárdalo en un lugar seguro.

### Manejo de errores 5xx de Spotify

Spotify a veces devuelve 503 en algunos endpoints. El script tiene:
- **Reintentos con backoff**: 2 intentos extra con espera exponencial (2s → 4s)
- **Fallback graceful**: los endpoints no críticos (`recently-played`, `tracks`) devuelven `null` en vez de tirar error

---

## 7. Proyecto 3: Anime Watchlist Widget

**Repo:** [`vndadev-revamped/AnimeWatchlistWidget`](https://github.com/vndadev-revamped/AnimeWatchlistWidget)
**Autor original:** Blankiiii (widget layout), basado en KaliPert (MAL sync)

### API usada

AniList GraphQL API. **No requiere API key ni OAuth.** Solo el username.

### Por qué AniList y no MyAnimeList

| | AniList | MyAnimeList |
|---|---|---|
| API key | ❌ No | ✅ Sí (Jikan tiene rate limits) |
| OAuth | ❌ No | ✅ Sí (para datos privados) |
| Formato | GraphQL (1 sola query) | REST (múltiples requests) |
| Secret necesario | Solo username | client_id + client_secret |

### AniList GraphQL explicado

GraphQL te permite pedir exactamente los datos que necesitas en una sola llamada. Ejemplo de la query que usamos:

```graphql
query($name: String) {
  User(name: $name) {
    statistics { anime { count } }
  }
  MediaListCollection(userName: $name, type: ANIME, status: COMPLETED, sort: SCORE_DESC) {
    lists {
      entries {
        score
        media {
          title { romaji english }
          coverImage { large }
        }
      }
    }
  }
}
```

Esto devuelve en una sola respuesta:
- Total de animes
- Lista de completados ordenados por puntuación (score)
- Título e imagen de cada uno

**Cómo se envía con `fetch` nativo:**
```javascript
const res = await fetch("https://graphql.anilist.co", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables: { name: "vandacortee" } }),
});
const data = await res.json();
```

### Deduplicación de series

AniList trata temporadas como entradas separadas. Si tienes "OSHI NO KO" y "OSHI NO KO Season 3" con puntuación alta, ocuparían 2 slots del top 3.

**Solución:** el script detecta patrones de temporada (`Season 1`, `2nd Season`, `Movie`, `Part 2`, etc.) y agrupa entradas de la misma franquicia, quedándose solo con la de mayor puntuación.

### Cómo puntuar animes en AniList

1. Ve a tu perfil: `https://anilist.co/user/TU_USERNAME`
2. En tu lista de anime, cada entrada tiene estrellas ⭐ a la derecha
3. Pasa el mouse y elige un score (1-100)
4. O usa las caritas 😊 para puntuación rápida

**Tip:** El widget usa los animes con **mayor puntuación**. Mientras más califiques, más preciso será tu top 3.

---

## 8. Widget layouts: cómo se arman

El `widget-layout.json` define la estructura visual del widget. Se importa en la extensión **Widget Creator**.

### Estructura de un layout

```json
{
  "_type": "discord-widget",
  "version": 2,
  "display_name": "Nombre del Widget",
  "surfaces": {
    "widget_top": { /* banner superior */ },
    "widget_bottom": { /* stats/colección */ },
    "mini_profile": { /* preview compacto */ },
    "add_widget_preview": { /* preview en tienda */ }
  }
}
```

### Tipos de layout disponibles

| Layout | Uso | Ejemplo |
|---|---|---|
| `widget_bottom_stats` | Grid de 6 stats numéricos/texto | Steam, Anime |
| `widget_bottom_collection` | Grid de 4 items con imagen | Anime (Blankiiii original) |
| `widget_top_hero` | Banner con hero image + título + subtítulos | Los 3 widgets |
| `mini_profile_hero_stat` | Stat compacto en mini perfil | Steam, Anime |
| `activity_accessory_stat` | Stat en activity | Steam |

### Cómo se vinculan layout y script

El `value` de cada campo en el layout debe coincidir con el `name` en el payload:

**En el layout (`widget-layout.json`):**
```json
{
  "value_type": "data",
  "value": "owned_games"
}
```

**En el script (`steam-widget.js`):**
```javascript
{ type: 2, name: "owned_games", value: 156 }
```

Si no coinciden, el widget muestra el fallback.

### Importante sobre assets e imágenes

Si el layout tiene un campo `image` con `value_type: "application_asset"`, el asset debe existir en la app de Discord. Se suben en Developer Portal → Rich Presence → Assets.

Si prefieres evitar assets manuales, usa `value_type: "custom_string"` con una URL directa:

```json
{
  "value_type": "custom_string",
  "presentation_type": "image",
  "value": "https://ejemplo.com/imagen.png"
}
```

---

## 9. Créditos

Cada widget tiene su autor original, documentado en el README de su repo.

| Widget | Repo Original | Autor |
|---|---|---|
| Steam | — | **ItsDenji777** |
| Spotify | [Blankiiii/Discord-Widget-Collection](https://github.com/Blankiiii/Discord-Widget-Collection) | **Blankiiii** |
| Anime Watchlist | [Blankiiii/Discord-Widget-Collection](https://github.com/Blankiiii/Discord-Widget-Collection) + [KaliPert/MAL-Synced-Discord-Widget](https://github.com/KaliPert/MAL-Synced-Discord-Widget) | **Blankiiii** + **KaliPert** |
| Extensión Widget Creator | [TheCreativeGod/Discord-Widgets-Extension](https://github.com/TheCreativeGod/Discord-Widgets-Extension) | **TheCreativeGod** |

---

## 10. Checklist final para cada widget

- [ ] App de Discord creada con "Create new widget" en Widget Creator
- [ ] `widget-layout.json` importado en la app
- [ ] 4 secrets en GitHub: 3 de Discord + 1 de la API externa
- [ ] Probar manualmente: Actions → Run workflow
- [ ] Verificar que el perfil de Discord muestra los datos correctos
- [ ] Si falla con 50025: recrear la app desde Widget Creator

---

*Última actualización: julio 2026*
