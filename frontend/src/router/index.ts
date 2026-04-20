import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { guest: true },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('@/views/auth/SetupView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/views/auth/ResetPasswordView.vue'),
      meta: { guest: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/AppLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/dashboard' },
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
        },
        {
          path: 'etudiants',
          name: 'etudiants',
          component: () => import('@/views/EtudiantsView.vue'),
        },
        {
          path: 'etudiants/:id',
          name: 'etudiant-detail',
          component: () => import('@/views/EtudiantDetailView.vue'),
        },
        {
          path: 'dossiers-etudiants',
          name: 'dossiers-etudiants',
          component: () => import('@/views/DossiersEtudiantsView.vue'),
        },
        {
          path: 'users',
          name: 'users',
          component: () => import('@/views/UsersView.vue'),
        },
        {
          path: 'filieres',
          name: 'filieres',
          component: () => import('@/views/FilieresView.vue'),
        },
        {
          path: 'filieres/:id/maquette',
          name: 'maquette-filiere',
          component: () => import('@/views/MaquetteView.vue'),
        },
        {
          path: 'enseignants',
          name: 'enseignants',
          component: () => import('@/views/EnseignantsView.vue'),
        },
        {
          path: 'enseignants/:id',
          name: 'enseignant-detail',
          component: () => import('@/views/EnseignantDetailView.vue'),
        },
        {
          path: 'finance',
          name: 'finance',
          component: () => import('@/views/FinanceView.vue'),
        },
        {
          path: 'paiements',
          name: 'paiements',
          component: () => import('@/views/PaiementsView.vue'),
        },
        {
          path: 'suivi-paiements',
          name: 'suivi-paiements',
          component: () => import('@/views/SuiviPaiementsView.vue'),
        },
        {
          path: 'depenses',
          name: 'depenses',
          component: () => import('@/views/DepensesView.vue'),
        },
        {
          path: 'autres-recettes',
          name: 'autres-recettes',
          component: () => import('@/views/AutresRecettesView.vue'),
        },
        {
          path: 'exonerations',
          name: 'exonerations',
          component: () => import('@/views/ExonerationsView.vue'),
        },
        {
          path: 'caisse',
          name: 'caisse',
          component: () => import('@/views/CaisseView.vue'),
        },
        {
          path: 'vacations',
          name: 'vacations',
          component: () => import('@/views/VacationsView.vue'),
        },
        {
          path: 'formations-individuelles',
          name: 'formations-individuelles',
          component: () => import('@/views/FormationsIndividuellesView.vue'),
        },
        {
          path: 'emplois-du-temps',
          name: 'emplois-du-temps',
          component: () => import('@/views/EmploisDuTempsView.vue'),
        },
        {
          path: 'emargement',
          name: 'emargement',
          component: () => import('@/views/EmargementView.vue'),
        },
        {
          path: 'suivi-emargements',
          name: 'suivi-emargements',
          component: () => import('@/views/SuiviEmargementsView.vue'),
        },
        {
          path: 'cahier-de-textes',
          name: 'cahier-de-textes',
          component: () => import('@/views/CahierDeTextesView.vue'),
        },
        {
          path: 'absences',
          name: 'absences',
          component: () => import('@/views/AbsencesView.vue'),
        },
        {
          path: 'notes-bulletins',
          name: 'notes-bulletins',
          component: () => import('@/views/NotesBulletinsView.vue'),
        },
        {
          path: 'rapports',
          name: 'rapports',
          component: () => import('@/views/RapportsView.vue'),
        },
        {
          path: 'communication',
          name: 'communication',
          component: () => import('@/views/CommunicationView.vue'),
        },
        {
          path: 'parcours',
          name: 'parcours',
          component: () => import('@/views/ParcoursView.vue'),
        },
        {
          path: 'classes',
          name: 'classes',
          component: () => import('@/views/ClassesView.vue'),
        },
        {
          path: 'annees-academiques',
          name: 'annees-academiques',
          component: () => import('@/views/AnneesAcademiquesView.vue'),
        },
        {
          path: 'tarifs',
          name: 'tarifs',
          component: () => import('@/views/TarifsView.vue'),
        },
        {
          path: 'parametres',
          name: 'parametres',
          component: () => import('@/views/ParametresView.vue'),
        },
        {
          path: 'securite',
          name: 'securite',
          component: () => import('@/views/SecurityView.vue'),
        },
        {
          path: 'audit-logs',
          name: 'audit-logs',
          component: () => import('@/views/AuditLogsView.vue'),
        },
        {
          path: 'backups',
          name: 'backups',
          component: () => import('@/views/BackupsView.vue'),
        },
        {
          path: 'rapports-ministere',
          name: 'rapports-ministere',
          component: () => import('@/views/RapportsMinistereView.vue'),
        },
        {
          path: 'notifications',
          name: 'notifications',
          component: () => import('@/views/NotificationsView.vue'),
        },
        {
          path: 'taches',
          name: 'taches',
          component: () => import('@/views/TachesView.vue'),
        },
        {
          path: 'mon-equipe',
          name: 'mon-equipe',
          component: () => import('@/views/MonEquipeView.vue'),
        },
        {
          path: 'demandes-absence',
          name: 'demandes-absence',
          component: () => import('@/views/DemandesAbsenceView.vue'),
        },
        {
          path: 'journal-activite',
          name: 'journal-activite',
          component: () => import('@/views/JournalActiviteView.vue'),
        },
        {
          path: 'espace-etudiant',
          name: 'espace-etudiant',
          component: () => import('@/views/EspaceEtudiantView.vue'),
        },
      ],
    },
    {
      path: '/verify/:numero',
      name: 'verify',
      component: () => import('@/views/VerifyView.vue'),
      meta: { public: true },
    },
    {
      path: '/verify-attestation/:ref',
      name: 'verify-attestation',
      component: () => import('@/views/VerifyAttestationView.vue'),
      meta: { public: true },
    },
    { path: '/utilisateurs', redirect: '/users' },
    {
      path: '/espace-parent',
      component: () => import('@/layouts/ParentLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'espace-parent',
          component: () => import('@/views/EspaceParentView.vue'),
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  if (auth.isAuthenticated && !auth.user) {
    try {
      await auth.fetchMe()
    } catch {
      auth.clear()
      return '/login'
    }
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return '/login'
  }

  if (to.meta.guest && auth.isAuthenticated) {
    return auth.needsSetup ? '/setup' : '/dashboard'
  }

  if (auth.isAuthenticated && auth.needsSetup && to.name !== 'setup') {
    return '/setup'
  }

  // Parent → redirigé vers espace-parent (sauf login/setup)
  if (auth.isAuthenticated && auth.user?.role === 'parent' && !to.path.startsWith('/espace-parent') && to.name !== 'login' && to.name !== 'setup') {
    return '/espace-parent'
  }
  // Non-parent → interdit d'accéder à espace-parent
  if (auth.isAuthenticated && auth.user?.role !== 'parent' && to.path.startsWith('/espace-parent')) {
    return '/dashboard'
  }

  // Étudiant → redirigé vers espace-etudiant (sauf pages autorisées)
  const etudiantAllowed = ['/espace-etudiant', '/emplois-du-temps', '/communication', '/verify']
  if (
    auth.isAuthenticated &&
    auth.user?.role === 'etudiant' &&
    !etudiantAllowed.some(p => to.path.startsWith(p)) &&
    to.name !== 'login' &&
    to.name !== 'setup'
  ) {
    return '/espace-etudiant'
  }

  // Non-étudiant → interdit d'accéder à espace-etudiant
  if (auth.isAuthenticated && auth.user?.role !== 'etudiant' && to.path.startsWith('/espace-etudiant')) {
    return '/dashboard'
  }
})

export default router
