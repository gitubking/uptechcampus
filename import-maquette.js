const https = require('https');

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxIiwiZW1haWwiOiJkZ0B1cHRlY2hmb3JtYXRpb24uY29tIiwicm9sZSI6ImRnIiwiaWF0IjoxNzc0NjQ2OTQzLCJleHAiOjE3NzUyNTE3NDN9.7JvfBiitpYZc_igMD2TVP9aJbZAtKl0NEOx1Xh0KAhI";

const maquette = {
  semestres: [
    {
      numero: 1,
      ues: [
        {
          code: "InfM111", intitule_ue: "Informatique", categorie: "majeure", credits_ue: 4,
          ecs: [
            {intitule: "Présentation du matériel informatique", cm: 10, td: 0, tp: 0, tpe: 10, vht: 20, coefficient: 0},
            {intitule: "Présentation des systèmes d'exploitation", cm: 0, td: 0, tp: 10, tpe: 10, vht: 20, coefficient: 2},
            {intitule: "Bureautique", cm: 0, td: 0, tp: 20, tpe: 20, vht: 40, coefficient: 3}
          ]
        },
        {
          code: "InfG111", intitule_ue: "Infographie 1", categorie: "majeure", credits_ue: 5,
          ecs: [
            {intitule: "Traitement d'images 1", cm: 15, td: 0, tp: 0, tpe: 15, vht: 30, coefficient: 4},
            {intitule: "Dessin Assisté par Ordinateur 1", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 2},
            {intitule: "Publication Assistée par Ordinateur 1", cm: 15, td: 0, tp: 0, tpe: 15, vht: 30, coefficient: 2}
          ]
        },
        {
          code: "AV111", intitule_ue: "Audiovisuel 1", categorie: "majeure", credits_ue: 5,
          ecs: [
            {intitule: "La lumière", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 0},
            {intitule: "La caméra et la prise de vue", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 4},
            {intitule: "Le son", cm: 10, td: 0, tp: 0, tpe: 10, vht: 20, coefficient: 3}
          ]
        },
        {
          code: "ComV111", intitule_ue: "Communication visuelle", categorie: "majeure", credits_ue: 4,
          ecs: [
            {intitule: "Sémiologie appliquée à l'image", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 0},
            {intitule: "Typographie et symbolique des formes", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 0}
          ]
        },
        {
          code: "CultA111", intitule_ue: "Culture artistique 1", categorie: "mineure", credits_ue: 3,
          ecs: [
            {intitule: "Photo 1", cm: 10, td: 0, tp: 0, tpe: 10, vht: 20, coefficient: 3},
            {intitule: "Lecture de plan cinématographique 1", cm: 0, td: 0, tp: 10, tpe: 10, vht: 20, coefficient: 2},
            {intitule: "Ateliers de création 1", cm: 0, td: 0, tp: 10, tpe: 10, vht: 20, coefficient: 2}
          ]
        },
        {
          code: "ArtPG111", intitule_ue: "Art plastique et graphisme 1", categorie: "mineure", credits_ue: 3,
          ecs: [
            {intitule: "Histoire de l'Art plastique 1", cm: 15, td: 0, tp: 0, tpe: 15, vht: 30, coefficient: 0},
            {intitule: "Graphisme 1", cm: 15, td: 0, tp: 0, tpe: 15, vht: 30, coefficient: 0}
          ]
        },
        {
          code: "Lang115", intitule_ue: "Langue 1", categorie: "renforcement", credits_ue: 2,
          ecs: [
            {intitule: "Anglais 1", cm: 0, td: 10, tp: 0, tpe: 10, vht: 20, coefficient: 2},
            {intitule: "Wolof ou Pulaar 1", cm: 0, td: 10, tp: 0, tpe: 10, vht: 20, coefficient: 0}
          ]
        },
        {
          code: "Droit111", intitule_ue: "Droit à l'image", categorie: "renforcement", credits_ue: 2,
          ecs: [
            {intitule: "Droit à l'image", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 2}
          ]
        },
        {
          code: "TRD111", intitule_ue: "Technique de recherche documentaire", categorie: "renforcement", credits_ue: 2,
          ecs: [
            {intitule: "Technique de recherche documentaire", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 0}
          ]
        }
      ]
    },
    {
      numero: 2,
      ues: [
        {
          code: "InfG121", intitule_ue: "Infographie 2", categorie: "majeure", credits_ue: 5,
          ecs: [
            {intitule: "Traitement d'image 2", cm: 15, td: 0, tp: 0, tpe: 15, vht: 30, coefficient: 2},
            {intitule: "Dessin Assisté par Ordinateur 2", cm: 15, td: 0, tp: 0, tpe: 15, vht: 30, coefficient: 4},
            {intitule: "Publication Assistée par Ordinateur 2", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 3}
          ]
        },
        {
          code: "WebM121", intitule_ue: "Webmaster 1", categorie: "majeure", credits_ue: 4,
          ecs: [
            {intitule: "Webdesign", cm: 0, td: 10, tp: 0, tpe: 10, vht: 20, coefficient: 0},
            {intitule: "Conception de site statique", cm: 0, td: 0, tp: 15, tpe: 15, vht: 30, coefficient: 5},
            {intitule: "Animation 2D 1", cm: 0, td: 0, tp: 15, tpe: 15, vht: 30, coefficient: 0}
          ]
        },
        {
          code: "AV121", intitule_ue: "Audiovisuel 2", categorie: "majeure", credits_ue: 5,
          ecs: [
            {intitule: "Initiation à la prise de son", cm: 0, td: 0, tp: 15, tpe: 15, vht: 30, coefficient: 3},
            {intitule: "Initiation au montage", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 4},
            {intitule: "Initiation aux effets spéciaux", cm: 15, td: 0, tp: 0, tpe: 15, vht: 30, coefficient: 2}
          ]
        },
        {
          code: "ImSyn121", intitule_ue: "Image de synthèse 1", categorie: "majeure", credits_ue: 4,
          ecs: [
            {intitule: "Introduction à la 3D", cm: 10, td: 0, tp: 0, tpe: 10, vht: 20, coefficient: 3},
            {intitule: "Modélisation 3D", cm: 10, td: 0, tp: 20, tpe: 30, vht: 60, coefficient: 3}
          ]
        },
        {
          code: "CultA121", intitule_ue: "Culture artistique 2", categorie: "mineure", credits_ue: 3,
          ecs: [
            {intitule: "Photo 2", cm: 0, td: 0, tp: 14, tpe: 6, vht: 20, coefficient: 3},
            {intitule: "Lecture de plan cinématographique 2", cm: 0, td: 0, tp: 10, tpe: 10, vht: 20, coefficient: 2},
            {intitule: "Ateliers de création 2", cm: 0, td: 0, tp: 10, tpe: 10, vht: 20, coefficient: 2}
          ]
        },
        {
          code: "ArtPG121", intitule_ue: "Art plastique et graphisme 2", categorie: "mineure", credits_ue: 3,
          ecs: [
            {intitule: "Histoire de l'Art plastique 2", cm: 10, td: 0, tp: 10, tpe: 20, vht: 40, coefficient: 0},
            {intitule: "Graphisme 2", cm: 10, td: 0, tp: 0, tpe: 10, vht: 20, coefficient: 0}
          ]
        },
        {
          code: "Lang125", intitule_ue: "Langue 2", categorie: "renforcement", credits_ue: 2,
          ecs: [
            {intitule: "Anglais 2", cm: 0, td: 10, tp: 0, tpe: 10, vht: 20, coefficient: 2},
            {intitule: "Wolof ou Pulaar 2", cm: 0, td: 10, tp: 0, tpe: 10, vht: 20, coefficient: 0}
          ]
        },
        {
          code: "Droit121", intitule_ue: "Droit de la propriété intellectuelle", categorie: "renforcement", credits_ue: 2,
          ecs: [
            {intitule: "Droit de la propriété intellectuelle", cm: 20, td: 0, tp: 0, tpe: 20, vht: 40, coefficient: 2}
          ]
        },
        {
          code: "Sport121", intitule_ue: "Sport", categorie: "renforcement", credits_ue: 2,
          ecs: [
            {intitule: "Sport", cm: 10, td: 0, tp: 10, tpe: 20, vht: 40, coefficient: 2}
          ]
        }
      ]
    }
  ]
};

const body = JSON.stringify(maquette);

const options = {
  hostname: 'uptechcampus.vercel.app',
  path: '/api/filieres/3/maquette',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', e => console.error('Error:', e.message));
req.write(body);
req.end();
