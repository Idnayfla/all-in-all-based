export const en = {
  // Chat empty state
  'chat.empty.subtitle': 'Describe what you want to build — Based brings it to life.',

  // Chat placeholders
  'chat.placeholder.default': 'Ask Based anything...',
  'chat.placeholder.video': 'Describe a video to generate...',
  'chat.placeholder.music': 'Describe the music to generate...',
  'chat.placeholder.image': 'Describe an image to generate...',
  'chat.placeholder.recording': 'Recording — press mic again to send…',
  'chat.placeholder.transcribing': 'Transcribing…',

  // Message roles
  'chat.role.you': 'YOU',
  'chat.role.based': 'BASED',

  // Buttons
  'chat.send': 'Send',
  'chat.generate': 'Generate',
  'chat.discard': '✕ Discard',

  // Loading states
  'chat.loading.thinking': 'Thinking',
  'chat.loading.analyzing': 'Analyzing your request',
  'chat.loading.planning': 'Planning the build',
  'chat.loading.generating': 'Building your app',
  'chat.loading.working': '◈ Working…',
  'chat.loading.preparing': 'Preparing',
  'chat.loading.searching': '◈ Searching the web…',
  'chat.loading.crowd': '◈ Checking crowd levels…',
  'chat.loading.traffic': '◈ Checking traffic conditions…',
  'chat.loading.retrying': '◈ Retrying…',
  'chat.loading.slow': '◈ Taking longer than usual — still working…',

  // Errors
  'chat.error.image': 'Image generation failed. Please try again.',
  'chat.error.music': 'Music generation failed. Please try again.',
  'chat.error.video': 'Video generation failed. Please try again.',
  'chat.error.generic': 'Something went wrong. Please try again.',
  'chat.error.cutoff': 'Response was cut off. Try a simpler request or Pro model.',

  // Flag / feedback
  'chat.flag.title': '⊙ Not what I expected',
  'chat.flag.noted': '◈ Noted — thanks',
  'chat.flag.expecting': 'What were you expecting?',
  'chat.flag.optional': 'Anything else? (optional)',
  'chat.flag.cancel': 'Cancel',
  'chat.flag.send': '→ Send',
  'chat.flag.sending': '◈ Sending…',
  'chat.flag.reason1': 'Wrong type of response',
  'chat.flag.reason2': 'Misunderstood my request',
  'chat.flag.reason3': 'Too much / too little',
  'chat.flag.reason4': 'Broke existing code',

  // Mobile sheet
  'chat.mobile.header': 'Ask Based anything',

  // Support nudge
  'chat.support.text': 'Based runs on community support — it keeps this free for everyone.',
  'chat.support.kofi': '◈ Support on Ko-fi',
  'chat.support.notNow': 'Not now',

  // Report
  'chat.report': '⬡ Report',
  'chat.reported': '◉ Reported',

  // App shell status
  'app.status.generating': 'Generating…',
  'app.status.ready': 'Ready',

  // Share
  'app.share.share': '↗ Share',
  'app.share.update': '↗ Update',
  'app.share.copied': '✓ Copied!',
  'app.share.gallery': '⬡ Gallery',
  'app.share.inGallery': '✓ In Gallery',

  // Incognito
  'app.incognito.banner': '◉ Incognito Mode — chat will be wiped when you exit',

  // No project screen
  'app.noproject.headline': 'You describe it. Based builds it.',
  'app.noproject.subtitle': 'HTML · Canvas games · Web apps · Tools · Dashboards',
  'app.noproject.new': '+ New Project',
  'app.noproject.signin': 'Sign in free · Projects save to your account',

  // Feedback / support buttons
  'app.feedback': '⬡ Feedback',
  'app.support': '◈ Support',

  // Settings panel
  'settings.title': '⬡ Settings',
  'settings.signOut': 'Sign Out',
  'settings.appearance': 'Appearance',
  'settings.aiModel': 'AI Model',
  'settings.persona': 'Persona',
  'settings.aiPersonality': 'AI Personality',
  'settings.globalMemory': 'Global Memory',
  'settings.projectMemory': 'Project Memory',
  'settings.plan': 'Plan',
  'settings.language': 'Language',
  'settings.support': 'Support Development',
  'settings.apiKeys': 'API Keys',
  'settings.wallpaper': 'Wallpaper',
  'settings.free': 'Free',
  'settings.pro': 'Pro',

  // Gallery
  'gallery.publish.title': '⬡ Publish to Gallery',
  'gallery.publish.cancel': 'Cancel',
  'gallery.publish.publish': 'Publish →',

  // Landing
  'landing.hero.headline': 'Never leaves your side.',
  'landing.hero.sub':
    'Not a tool. Not just a chatbot. Based is your personal assistant AI — creative, technical, always available.',
  'landing.cta.start': 'Start free →',
  'landing.cta.signin': 'Sign In',
  'landing.hint': 'Free to start · 10 generations/month · No credit card needed',
  'landing.closing.headline': 'Your companion is waiting.',
  'landing.closing.cta': 'Start free →',
  'landing.nav.gallery': 'Gallery',
  'landing.nav.roadmap': 'Roadmap',
};

export type Translations = typeof en;
