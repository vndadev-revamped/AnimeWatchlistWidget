const https = require('https');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURACIÓN (Desde Variables de Entorno)
// ==========================================
const ANILIST_USERNAME = process.env.ANILIST_USERNAME;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID; // Debe ser el SERVER ID

if (!ANILIST_USERNAME || !DISCORD_TOKEN || !DISCORD_APPLICATION_ID || !DISCORD_USER_ID) {
  console.error('[ERROR] Faltan variables de entorno necesarias.');
  process.exit(1);
}

// ==========================================
// CARGAR LAYOUT DESDE JSON (Como Steam/Spotify)
// ==========================================
let layoutConfig;
try {
  const layoutPath = path.join(__dirname, 'widget-layout.json');
  const layoutData = fs.readFileSync(layoutPath, 'utf8');
  layoutConfig = JSON.parse(layoutData);
  console.log('[INFO] widget-layout.json cargado correctamente.');
} catch (error) {
  console.error('[ERROR] No se pudo leer o parsear widget-layout.json:', error.message);
  process.exit(1);
}

// Extraer los nombres de las variables dinámicas del JSON
// Buscamos en data.dynamic los nombres para usarlos como claves
const dynamicFieldsConfig = layoutConfig.data?.dynamic || [];
const fieldNames = {};

dynamicFieldsConfig.forEach(field => {
  if (field.name) {
    // Guardamos el tipo esperado si quisieramos validarlo, pero principalmente el nombre
    fieldNames[field.name] = field.type; 
  }
});

// Validar que tenemos los campos necesarios
const requiredFields = ['anime_watched', 'anime_nr1', 'anime_nr2', 'anime_nr3', 'anime_1', 'anime_2', 'anime_3'];
const missingFields = requiredFields.filter(f => !fieldNames[f]);

if (missingFields.length > 0) {
  console.warn(`[WARN] El layout no define los campos: ${missingFields.join(', ')}. El widget podría no mostrarse bien.`);
} else {
  console.log('[INFO] Todos los campos requeridos encontrados en el layout.');
}

// ==========================================
// QUERY GRAPHQL A ANILIST
// ==========================================
const query = `
query ($userName: String) {
  MediaListCollection(userName: $userName, type: ANIME, status: COMPLETED) {
    lists {
      entries {
        media {
          title {
            romaji
            english
          }
          coverImage {
            large
          }
          averageScore
        }
        score
      }
    }
    user {
      statistics {
        anime {
          count
        }
      }
    }
  }
}
`;

const variables = { userName: ANILIST_USERNAME };

// ==========================================
// FUNCIÓN: PETICIÓN HTTPS A ANILIST
// ==========================================
function fetchAniListData() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const options = {
      hostname: 'graphql.anilist.co',
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(responseData);
          if (json.errors) throw new Error(json.errors[0].message);
          resolve(json.data);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

// ==========================================
// LÓGICA SIMPLE: TOP 3 POR PUNTAJE (Sin deduplicación rara)
// ==========================================
function getTop3Simple(animeList) {
  // 1. Filtrar válidos
  const validAnime = animeList.filter(entry => entry.score > 0 && entry.media);

  // 2. Ordenar por score descendente
  validAnime.sort((a, b) => b.score - a.score);

  // 3. Tomar los primeros 3
  return validAnime.slice(0, 3).map(entry => ({
    title: entry.media.title.english || entry.media.title.romaji || "Desconocido",
    score: entry.score,
    image: entry.media.coverImage.large
  }));
}

// ==========================================
// FUNCIÓN PRINCIPAL
// ==========================================
async function main() {
  console.log(`[INFO] Iniciando actualización para usuario: ${ANILIST_USERNAME}`);

  try {
    // 1. Obtener datos de AniList
    console.log('[INFO] Conectando con AniList API...');
    const data = await fetchAniListData();
    
    const listEntries = data.MediaListCollection.lists.flatMap(list => list.entries);
    const stats = data.MediaListCollection.user.statistics.anime;

    console.log(`[INFO] Total animes encontrados: ${listEntries.length}`);

    // 2. Calcular Top 3 Simple
    console.log('[INFO] Calculando Top 3 por puntuación...');
    const top3 = getTop3Simple(listEntries);

    if (top3.length === 0) {
      console.warn('[WARN] No se encontraron animes con puntuación.');
    } else {
      console.log('[INFO] Top 3 seleccionado:');
      top3.forEach((anime, i) => {
        console.log(`   #${i+1}: "${anime.title}" (Score: ${anime.score})`);
      });
    }

    // 3. Construir Payload usando LOS NOMBRES DEL JSON
    const dynamicFields = [];

    // A. Campo: Total Anime Watched
    // Usamos el nombre exacto del JSON: 'anime_watched'
    if (fieldNames['anime_watched'] !== undefined) {
      dynamicFields.push({
        type: fieldNames['anime_watched'], // Respeta el tipo del JSON (1 para texto)
        name: "anime_watched",
        value: stats.count.toString() 
      });
    }

    // B. Campos: Top 3 Nombres e Imágenes
    for (let i = 0; i < 3; i++) {
      const index = i + 1;
      const nameKey = `anime_nr${index}`;
      const imageKey = `anime_${index}`;

      if (top3[i]) {
        // Nombre
        if (fieldNames[nameKey] !== undefined) {
          dynamicFields.push({
            type: fieldNames[nameKey],
            name: nameKey,
            value: top3[i].title
          });
        }
        // Imagen
        if (fieldNames[imageKey] !== undefined) {
          dynamicFields.push({
            type: fieldNames[imageKey],
            name: imageKey,
            value: { url: top3[i].image }
          });
        }
      } else {
        // Rellenar si no hay datos
        if (fieldNames[nameKey] !== undefined) {
          dynamicFields.push({ type: fieldNames[nameKey], name: nameKey, value: "N/A" });
        }
        if (fieldNames[imageKey] !== undefined) {
          dynamicFields.push({ type: fieldNames[imageKey], name: imageKey, value: { url: "https://via.placeholder.com/150?text=Empty" } });
        }
      }
    }

    // Estructura final del payload (igual que Steam/Spotify)
    const payload = {
      data: {
        dynamic: dynamicFields
      }
    };

    console.log('[INFO] Payload generado con nombres del layout.');
    // console.log(JSON.stringify(payload, null, 2)); 

    // 4. Enviar a Discord API
    console.log('[INFO] Enviando actualización a Discord...');
    const discordData = JSON.stringify(payload);
    const discordOptions = {
      hostname: 'discord.com',
      path: `/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_USER_ID}/widget`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bot ${DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': discordData.length
      }
    };

    await new Promise((resolve, reject) => {
      const req = https.request(discordOptions, (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('[SUCCESS] ✅ Widget de Discord actualizado correctamente.');
            resolve();
          } else {
            console.error(`[ERROR] ❌ Discord API respondió con ${res.statusCode}: ${responseData}`);
            console.error('[HINT] Verifica que DISCORD_USER_ID sea el ID del SERVIDOR, no de la App ni del Usuario.');
            reject(new Error(`Discord API Error: ${res.statusCode}`));
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.write(discordData);
      req.end();
    });

    console.log('[INFO] 🎉 Proceso finalizado con éxito.');

  } catch (error) {
    console.error('[FATAL] 💥 Error crítico:', error.message);
    process.exit(1);
  }
}

main();
