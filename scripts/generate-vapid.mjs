// Run locally only. These keys are server secrets: never paste them in chat.
import * as webPush from 'web-push'

const keys = webPush.generateVAPIDKeys()
console.log('Add these to your local .env and to the Render environment:')
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
