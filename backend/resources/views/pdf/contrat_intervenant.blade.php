<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: DejaVu Sans, sans-serif; font-size: 11px; color: #111; }

        .header { display: table; width: 100%; border-bottom: 3px solid #E30613; padding-bottom: 12px; margin-bottom: 20px; }
        .header-left { display: table-cell; width: 60%; vertical-align: middle; }
        .header-right { display: table-cell; width: 40%; text-align: right; vertical-align: middle; }
        .logo-text { font-size: 24px; font-weight: bold; color: #E30613; letter-spacing: 2px; }
        .logo-sub { font-size: 9px; color: #555; margin-top: 2px; }
        .doc-title { font-size: 13px; font-weight: bold; color: #111; }
        .doc-ref { font-size: 10px; color: #666; margin-top: 4px; }

        h2 { font-size: 13px; font-weight: bold; color: #E30613; margin: 16px 0 8px; text-transform: uppercase; border-bottom: 1px solid #eee; padding-bottom: 4px; }
        .section { margin-bottom: 14px; }

        table.info { width: 100%; border-collapse: collapse; }
        table.info td { padding: 5px 8px; border: 1px solid #ddd; vertical-align: top; }
        table.info td.label { width: 38%; background: #f5f5f5; font-weight: bold; color: #444; }

        table.tarifs { width: 100%; border-collapse: collapse; margin-top: 8px; }
        table.tarifs th { background: #E30613; color: #fff; padding: 6px 10px; text-align: left; font-size: 10px; }
        table.tarifs td { padding: 5px 10px; border-bottom: 1px solid #eee; }

        .filieres-list { margin: 8px 0; }
        .filiere-badge { display: inline-block; background: #f0f0f0; border: 1px solid #ccc; padding: 2px 8px; border-radius: 10px; font-size: 10px; margin: 2px; }

        .article { margin-bottom: 10px; }
        .article-title { font-weight: bold; margin-bottom: 4px; }
        .article-body { color: #333; line-height: 1.5; }

        .signatures { margin-top: 30px; display: table; width: 100%; }
        .sig-col { display: table-cell; width: 50%; text-align: center; padding: 0 20px; }
        .sig-box { border: 1px solid #ccc; height: 70px; margin: 8px 0; background: #fafafa; }
        .sig-label { font-size: 10px; color: #555; }
        .sig-title { font-weight: bold; margin-bottom: 4px; font-size: 11px; }

        .footer { margin-top: 20px; border-top: 1px solid #ddd; padding-top: 8px; font-size: 9px; color: #888; text-align: center; }
        .badge { display: inline-block; background: #E30613; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: bold; }
    </style>
</head>
<body>

{{-- HEADER --}}
<div class="header">
    <div class="header-left">
        <div class="logo-text">UPTECH</div>
        <div class="logo-sub">Institut Supérieur de Formation aux Métiers du Numérique</div>
        <div style="font-size:9px; color:#888; margin-top:4px;">
            {{ $etablissement['adresse'] ?? 'Amitié 1, Villa n°3031 — Dakar, Sénégal' }}<br>
            {{ $etablissement['telephone'] ?? '+221 77 841 50 44' }} — {{ $etablissement['email_contact'] ?? 'contact@uptechformation.com' }}
        </div>
    </div>
    <div class="header-right">
        <div class="doc-title">CONTRAT INTERVENANT VACATAIRE</div>
        <div class="doc-ref">N° {{ $intervenant->numero_contrat }}</div>
        <div class="doc-ref">Année : {{ $intervenant->anneeAcademique?->libelle ?? date('Y').'/'.( date('Y')+1) }}</div>
        <div style="margin-top:6px;"><span class="badge">{{ strtoupper($intervenant->statut) }}</span></div>
    </div>
</div>

{{-- PARTIES --}}
<h2>Parties au contrat</h2>
<div class="section">
    <table class="info">
        <tr>
            <td class="label">L'Institut</td>
            <td>{{ $etablissement['nom_etablissement'] ?? 'Institut UPTECH Formation' }}, représenté par son Directeur Général</td>
        </tr>
        <tr>
            <td class="label">L'Intervenant(e)</td>
            <td><strong>{{ $intervenant->prenom }} {{ $intervenant->nom }}</strong> — Réf. {{ $intervenant->numero_contrat }}</td>
        </tr>
    </table>
</div>

{{-- INFORMATIONS INTERVENANT --}}
<h2>Informations personnelles</h2>
<div class="section">
    <table class="info">
        <tr>
            <td class="label">Nom complet</td>
            <td>{{ $intervenant->prenom }} {{ $intervenant->nom }}</td>
            <td class="label">N° Contrat</td>
            <td>{{ $intervenant->numero_contrat }}</td>
        </tr>
        <tr>
            <td class="label">Email</td>
            <td>{{ $intervenant->email }}</td>
            <td class="label">Téléphone</td>
            <td>{{ $intervenant->telephone ?? '—' }}</td>
        </tr>
    </table>
</div>

{{-- FILIÈRES --}}
<h2>Filières et matières enseignées</h2>
<div class="section">
    @if($intervenant->filieres->isNotEmpty())
        <div class="filieres-list">
            @foreach($intervenant->filieres as $fil)
                <span class="filiere-badge">
                    {{ $fil->filiere?->nom ?? '—' }}
                    @if($fil->matieres) — {{ $fil->matieres }} @endif
                </span>
            @endforeach
        </div>
    @else
        <p>Filières à définir en accord avec la Direction Pédagogique.</p>
    @endif
</div>

{{-- TARIF --}}
<h2>Conditions de rémunération</h2>
<div class="section">
    <table class="tarifs">
        <thead>
            <tr>
                <th>Désignation</th>
                <th style="text-align:right;">Tarif</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>Tarif horaire vacataire (FCFA/heure)</td>
                <td style="text-align:right; font-weight:bold;">
                    Selon grille tarifaire en vigueur
                </td>
            </tr>
            <tr>
                <td>Mode de calcul</td>
                <td>Heures dispensées × tarif horaire en vigueur</td>
            </tr>
            <tr>
                <td>Émargement</td>
                <td>Numérique — obligatoire après chaque cours</td>
            </tr>
            <tr>
                <td>Bordereau mensuel</td>
                <td>Calculé automatiquement — validé par DG ou Resp. Financier</td>
            </tr>
        </tbody>
    </table>
    <p style="margin-top:8px; font-size:10px; color:#555;">
        Note : Le tarif exact est défini dans la grille tarifaire annuelle de l'Institut et communiqué séparément.
        En cas de classe regroupant plusieurs types de formation (tronc commun), le tarif le plus élevé est appliqué.
    </p>
</div>

{{-- ENGAGEMENTS --}}
<h2>Engagements des parties</h2>
<div class="section">
    <div class="article">
        <div class="article-title">Article 1 — Engagement de l'Institut</div>
        <div class="article-body">L'Institut s'engage à rémunérer l'Intervenant(e) pour les heures effectivement dispensées et émargées numériquement, selon la grille tarifaire en vigueur, dans un délai raisonnable après validation du bordereau mensuel.</div>
    </div>
    <div class="article">
        <div class="article-title">Article 2 — Engagement de l'Intervenant(e)</div>
        <div class="article-body">L'Intervenant(e) s'engage à dispenser les cours selon les horaires définis dans l'emploi du temps, à effectuer l'émargement numérique après chaque cours, à respecter le programme pédagogique et le règlement intérieur de l'Institut.</div>
    </div>
    <div class="article">
        <div class="article-title">Article 3 — Durée</div>
        <div class="article-body">Le présent contrat est valable pour l'année académique {{ $intervenant->anneeAcademique?->libelle ?? date('Y').'/'.( date('Y')+1) }}. Il prend fin automatiquement à l'issue de l'année académique et doit être renouvelé pour la période suivante.</div>
    </div>
</div>

{{-- SIGNATURES --}}
<div class="signatures">
    <div class="sig-col">
        <div class="sig-title">L'Institut UPTECH Formation</div>
        <div class="sig-label">Le Directeur Général</div>
        <div class="sig-box"></div>
        <div class="sig-label">Signature et cachet</div>
    </div>
    <div class="sig-col">
        <div class="sig-title">L'Intervenant(e)</div>
        <div class="sig-label">{{ $intervenant->prenom }} {{ $intervenant->nom }}</div>
        <div class="sig-box"></div>
        <div class="sig-label">Lu et approuvé — Signature précédée de la mention manuscrite</div>
    </div>
</div>

{{-- FOOTER --}}
<div class="footer">
    {{ $etablissement['nom_etablissement'] ?? 'Institut UPTECH Formation' }} · {{ $etablissement['adresse'] ?? 'Amitié 1, Villa n°3031 — Dakar, Sénégal' }}
    · {{ $etablissement['telephone'] ?? '+221 77 841 50 44' }} · {{ $etablissement['site_web'] ?? 'uptechformation.com' }}
    <br>Document généré le {{ now()->locale('fr')->isoFormat('D MMMM YYYY [à] HH:mm') }} — UPTECH Campus
</div>

</body>
</html>
