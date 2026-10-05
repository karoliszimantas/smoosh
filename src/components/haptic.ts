// A light tick, for landing on a detent.
//
// Android: the Vibration API. iOS Safari has no Vibration API, but since
// iOS 18 toggling a native switch control ticks the Taptic Engine — so a
// hidden one is toggled instead. Whether iOS honours that outside a direct
// tap varies; where nothing works, this is silently nothing.
let iosSwitch: HTMLLabelElement | null = null

export function haptic(): void {
  if (typeof navigator.vibrate === 'function' && !/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    navigator.vibrate(8)
    return
  }
  if (!iosSwitch) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.setAttribute('switch', '')
    input.tabIndex = -1
    label.appendChild(input)
    label.setAttribute('aria-hidden', 'true')
    label.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
    document.body.appendChild(label)
    iosSwitch = label
  }
  iosSwitch.click()
}
