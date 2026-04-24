<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'
import { UcModal, UcFormGroup, UcFormGrid, UcPageHeader } from '@/components/ui'

const toast = useToast()

interface TypeFormation { id: number; nom: string; code: string }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }
interface Tarif {
  id: number
  montant_horaire: number
  date_effet: string
  type_formation?: TypeFormation
  annee_academique?: AnneeAcademique
}

const tarifs = ref<Tarif[]>([])
const typesFormation = ref<TypeFormation[]>([])
const annees = ref<AnneeAcademique[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)
const editingId = ref<number | null>(null)

const form = ref({
  type_formation_id: null as number | null,
  annee_academique_id: null as number | null,
  montant_horaire: 0,
  date_effet: new Date().toISOString().split('T')[0],
})

function formatAmount(n: number) {
  return new Intl.NumberFormat('fr-FR').format(n) + ' FCFA/h'
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function openCreate() {
  editingId.value = null
  const anneeActive = annees.value.find(a => a.actif)
  form.value = {
    type_formation_id: typesFormation.value[0]?.id ?? null,
    annee_academique_id: anneeActive?.id ?? annees.value[0]?.id ?? null,
    montant_horaire: 0,
    date_effet: new Date().toISOString().split('T')[0],
  }
  error.value = ''
  showForm.value = true
}

function openEdit(t: Tarif) {
  editingId.value = t.id
  form.value = {
    type_formation_id: t.type_formation?.id ?? null,
    annee_academique_id: t.annee_academique?.id ?? null,
    montant_horaire: t.montant_horaire,
    date_effet: t.date_effet?.slice(0, 10) ?? new Date().toISOString().split('T')[0],
  }
  error.value = ''
  showForm.value = true
}

async function load() {
  loading.value = true
  try {
    const [t, tf, a] = await Promise.all([
      api.get('/tarifs'),
      api.get('/types-formation'),
      api.get('/annees-academiques'),
    ])
    tarifs.value = t.data
    typesFormation.value = tf.data
    annees.value = a.data
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (editingId.value) {
      // Modification
      const { data } = await api.put(`/tarifs/${editingId.value}`, {
        montant_horaire: form.value.montant_horaire,
        date_effet: form.value.date_effet,
      })
      await load() // recharge pour récupérer les jointures
    } else {
      // Création
      const { data } = await api.post('/tarifs', form.value)
      await load()
    }
    showForm.value = false
  } catch (e: any) {
    const errs = e.response?.data?.errors as Record<string, string[]> | undefined
    error.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? e.response?.data?.error ?? 'Erreur'
  } finally {
    saving.value = false
  }
}

async function supprimerTarif(t: Tarif) {
  if (!confirm(`Supprimer le tarif ${t.type_formation?.nom} — ${t.annee_academique?.libelle} ?`)) return
  try {
    await api.delete(`/tarifs/${t.id}`)
    tarifs.value = tarifs.value.filter(x => x.id !== t.id)
  } catch (e: any) {
    toast.apiError(e, 'Erreur')
  }
}

onMounted(load)
</script>

<template>
  <div class="uc-content">
    <UcPageHeader title="Tarifs enseignants" subtitle="Taux horaires par type de formation et année académique">
      <template #actions>
        <button @click="openCreate" class="uc-btn-primary">+ Définir un tarif</button>
      </template>
    </UcPageHeader>

    <div class="uc-alert uc-alert-info" style="margin-bottom:16px;">
      <strong>Règle tronc commun :</strong> Lorsqu'une séance regroupe plusieurs types de formation, le taux le plus élevé est appliqué à l'enseignant.
    </div>

    <div class="uc-table-wrap">
      <div v-if="loading" class="uc-empty">Chargement…</div>
      <div v-else-if="tarifs.length === 0" class="uc-empty">Aucun tarif défini</div>
      <table v-else class="uc-table">
        <thead>
          <tr>
            <th>Type de formation</th>
            <th>Année académique</th>
            <th style="text-align:right;">Taux horaire</th>
            <th>Date d'effet</th>
            <th style="text-align:center;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in tarifs" :key="t.id">
            <td>
              <span style="font-weight:600;">{{ t.type_formation?.nom ?? '—' }}</span>
              <span style="margin-left:6px;font-size:11px;font-family:monospace;color:#94a3b8;">{{ t.type_formation?.code }}</span>
            </td>
            <td>{{ t.annee_academique?.libelle ?? '—' }}</td>
            <td style="text-align:right;font-weight:700;">{{ formatAmount(t.montant_horaire) }}</td>
            <td>{{ formatDate(t.date_effet) }}</td>
            <td style="text-align:center;">
              <div style="display:flex;gap:6px;justify-content:center;">
                <button @click="openEdit(t)" class="uc-btn-xs" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">✏️ Modifier</button>
                <button @click="supprimerTarif(t)" class="uc-btn-xs" style="background:#fef2f2;color:#dc2626;border-color:#fecaca;">🗑️</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal créer / modifier -->
    <UcModal v-model="showForm"
      :title="editingId ? 'Modifier le tarif' : 'Définir un tarif'"
      width="460px"
      @close="error = ''">
      <div v-if="error" class="uc-alert uc-alert-error" style="margin-bottom:12px;">{{ error }}</div>
      <UcFormGrid :cols="1">
        <UcFormGroup label="Type de formation" :required="true">
          <select v-model="form.type_formation_id" class="uc-input" :disabled="!!editingId">
            <option v-for="tf in typesFormation" :key="tf.id" :value="tf.id">{{ tf.nom }}</option>
          </select>
          <div v-if="editingId" style="font-size:11px;color:#94a3b8;margin-top:4px;">Non modifiable — supprimer et recréer si besoin.</div>
        </UcFormGroup>
        <UcFormGroup label="Année académique" :required="true">
          <select v-model="form.annee_academique_id" class="uc-input" :disabled="!!editingId">
            <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Taux horaire (FCFA/h)" :required="true">
          <input v-model.number="form.montant_horaire" type="number" min="0" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Date d'effet" :required="true">
          <input v-model="form.date_effet" type="date" class="uc-input" />
        </UcFormGroup>
      </UcFormGrid>
      <template #footer>
        <button @click="showForm = false" class="uc-btn-outline">Annuler</button>
        <button @click="save" :disabled="saving" class="uc-btn-primary">
          {{ saving ? 'Enregistrement…' : (editingId ? 'Mettre à jour' : 'Enregistrer') }}
        </button>
      </template>
    </UcModal>
  </div>
</template>
