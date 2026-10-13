import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

// O jsdom não implementa scrollIntoView (usado pela tira de dias, DatePickers): no-op.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// O jsdom não implementa <dialog>.showModal/close; versão mínima para os testes.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
