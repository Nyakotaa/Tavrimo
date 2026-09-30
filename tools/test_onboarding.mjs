import fs from 'fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const required = ['onboarding', 'onboardingSpotlight', 'onboardingCard', 'onboardingHelpBtn', 'tabAdd', 'todayDateChip'];
for (const id of required) if (!html.includes(`id="${id}"`)) throw new Error(`Missing onboarding element: ${id}`);
for (const token of ['ONBOARDING_STEPS', 'startOnboarding', 'finishOnboarding', 'refreshOnboardingTarget', 'nextOnboarding', 'prevOnboarding']) if (!js.includes(token)) throw new Error(`Missing onboarding logic: ${token}`);
if (!html.includes('apple-touch-icon-v16.png')) throw new Error('Missing current Apple touch icon reference');
if (!html.includes('<strong>Tavrimo</strong>')) throw new Error('Brand not updated in header');
console.log('Onboarding static tests passed.');
