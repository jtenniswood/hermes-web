export function getBrowserTarget(env = process.env) {
  if (env.HERMES_TEST_IMAGE && env.HERMES_BROWSER_PREVIEW_IMAGE && env.HERMES_TEST_IMAGE !== env.HERMES_BROWSER_PREVIEW_IMAGE) {
    throw new Error('HERMES_TEST_IMAGE and HERMES_BROWSER_PREVIEW_IMAGE disagree; use HERMES_TEST_IMAGE for the required built-image target')
  }
  return {
    image: env.HERMES_TEST_IMAGE || env.HERMES_BROWSER_PREVIEW_IMAGE,
    url: env.HERMES_BROWSER_PREVIEW_URL
  }
}

export function requireBrowserImage(env = process.env) {
  const { image } = getBrowserTarget(env)
  if (!image) {
    throw new Error('HERMES_TEST_IMAGE must identify the built nginx image (HERMES_BROWSER_PREVIEW_IMAGE is a temporary local alias)')
  }
  return image
}
