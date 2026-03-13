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

        table.fees { width: 100%; border-collapse: collapse; margin-top: 8px; }
        table.fees th { background: #E30613; color: #fff; padding: 6px 10px; text-align: left; font-size: 10px; }
        table.fees td { padding: 5px 10px; border-bottom: 1px solid #eee; }
        table.fees tr:last-child td { font-weight: bold; border-top: 2px solid #E30613; }

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
        <div class="doc-title">CONTRAT D'INSCRIPTION</div>
        <div class="doc-ref">N° {{ $inscription->numero_contrat ?? 'CONT-'.date('Y').'-'.str_pad($inscription->id, 5, '0', STR_PAD_LEFT) }}</div>
        <div class="doc-ref">Date : {{ now()->locale('fr')->isoFormat('D MMMM YYYY') }}</div>
        <div style="margin-top:6px;"><span class="badge">{{ strtoupper($inscription->statut) }}</span></div>
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
            <td class="label">L'Étudiant(e)</td>
            <td><strong>{{ $etudiant->prenom }} {{ $etudiant->nom }}</strong> — N° {{ $etudiant->numero_etudiant }}</td>
        </tr>
    </table>
</div>

{{-- INFORMATIONS ÉTUDIANT --}}
<h2>Informations personnelles</h2>
<div class="section">
    <table class="info">
        <tr>
            <td class="label">Nom complet</td>
            <td>{{ $etudiant->prenom }} {{ $etudiant->nom }}</td>
            <td class="label">N° étudiant</td>
            <td>{{ $etudiant->numero_etudiant }}</td>
        </tr>
        <tr>
            <td class="label">Email</td>
            <td>{{ $etudiant->email }}</td>
            <td class="label">Téléphone</td>
            <td>{{ $etudiant->telephone ?? '—' }}</td>
        </tr>
        <tr>
            <td class="label">Date de naissance</td>
            <td>{{ $etudiant->date_naissance ? \Carbon\Carbon::parse($etudiant->date_naissance)->locale('fr')->isoFormat('D MMMM YYYY') : '—' }}</td>
            <td class="label">Lieu de naissance</td>
            <td>{{ $etudiant->lieu_naissance ?? '—' }}</td>
        </tr>
        <tr>
            <td class="label">Adresse</td>
            <td colspan="3">{{ $etudiant->adresse ?? '—' }}</td>
        </tr>
        <tr>
            <td class="label">N° CNI / Passeport</td>
            <td colspan="3">{{ $etudiant->cni_numero ?? '—' }}</td>
        </tr>
    </table>
</div>

{{-- FORMATION --}}
<h2>Formation souscrite</h2>
<div class="section">
    <table class="info">
        <tr>
            <td class="label">Filière</td>
            <td>{{ $inscription->classe?->filiere?->nom ?? '—' }}</td>
            <td class="label">Parcours</td>
            <td>{{ $inscription->parcours?->nom ?? '—' }}</td>
        </tr>
        <tr>
            <td class="label">Classe</td>
            <td>{{ $inscription->classe?->nom ?? '—' }}</td>
            <td class="label">Année académique</td>
            <td>{{ $inscription->anneeAcademique?->libelle ?? '—' }}</td>
        </tr>
        <tr>
            <td class="label">Type de formation</td>
            <td colspan="3">{{ $inscription->parcours?->typeFormation?->nom ?? '—' }}</td>
        </tr>
    </table>
</div>

{{-- FRAIS --}}
<h2>Conditions financières</h2>
<div class="section">
    <table class="fees">
        <thead>
            <tr>
                <th>Désignation</th>
                <th style="text-align:right;">Montant (FCFA)</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>Frais d'inscription (paiement unique)</td>
                <td style="text-align:right;">{{ number_format($inscription->frais_inscription, 0, ',', ' ') }} FCFA</td>
            </tr>
            <tr>
                <td>Mensualité de scolarité</td>
                <td style="text-align:right;">{{ number_format($inscription->mensualite, 0, ',', ' ') }} FCFA / mois</td>
            </tr>
            @if($inscription->reduction_type)
            <tr>
                <td>Réduction accordée
                    @if($inscription->reduction_type === 'pourcentage')
                        ({{ $inscription->reduction_valeur }}%)
                    @else
                        (montant fixe)
                    @endif
                </td>
                <td style="text-align:right; color:#E30613;">
                    @if($inscription->reduction_type === 'pourcentage')
                        -{{ number_format($inscription->mensualite * $inscription->reduction_valeur / 100, 0, ',', ' ') }} FCFA
                    @else
                        -{{ number_format($inscription->reduction_valeur, 0, ',', ' ') }} FCFA
                    @endif
                </td>
            </tr>
            @endif
            <tr>
                <td><strong>Mensualité effective après réduction</strong></td>
                <td style="text-align:right;"><strong>{{ number_format($inscription->mensualite_effective, 0, ',', ' ') }} FCFA / mois</strong></td>
            </tr>
        </tbody>
    </table>
    <p style="margin-top:8px; font-size:10px; color:#555;">
        Modes de paiement acceptés : Espèces · Wave · Orange Money · Virement bancaire · Chèque
    </p>
</div>

{{-- ENGAGEMENTS --}}
<h2>Engagements des parties</h2>
<div class="section">
    <div class="article">
        <div class="article-title">Article 1 — Engagement de l'Institut</div>
        <div class="article-body">L'Institut s'engage à dispenser les enseignements correspondant à la formation souscrite, selon les horaires et le programme définis, et à délivrer les attestations et diplômes correspondants en cas de succès.</div>
    </div>
    <div class="article">
        <div class="article-title">Article 2 — Engagement de l'Étudiant(e)</div>
        <div class="article-body">L'étudiant(e) s'engage à régler les frais de scolarité selon les modalités définies ci-dessus, à respecter le règlement intérieur de l'Institut, et à assister régulièrement aux cours programmés.</div>
    </div>
    <div class="article">
        <div class="article-title">Article 3 — Paiements</div>
        <div class="article-body">Les mensualités sont dues le 1er de chaque mois. Tout retard de plus de 30 jours peut entraîner une suspension temporaire de l'accès aux cours, sur décision de la Direction.</div>
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
        <div class="sig-title">L'Étudiant(e)</div>
        <div class="sig-label">{{ $etudiant->prenom }} {{ $etudiant->nom }}</div>
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
