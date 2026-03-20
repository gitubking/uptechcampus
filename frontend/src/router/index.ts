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
          path: 'depenses',
          name: 'depenses',
          component: () => import('@/views/DepensesView.vue'),
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
      ],
    },
    {
      path: '/espace-etudiant',
      component: () => import('@/layouts/EtudiantLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'espace-etudiant', component: () => import('@/views/EspaceEtudiantView.vue') },
      ],
    },
    {
      path: '/verify/:numero',
      name: 'verify',
      component: () => import('@/views/VerifyView.vue'),
      meta: { public: true },
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

  // Étudiant → toujours redirigé vers espace-etudiant (sauf pages publiques)
  if (
    auth.isAuthenticated &&
    auth.user?.role === 'etudiant' &&
    !to.path.startsWith('/espace-etudiant') &&
    !to.path.startsWith('/verify') &&
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
