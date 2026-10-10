import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OtpInput } from './OtpInput'

function Harness() {
  const [value, setValue] = useState('')
  return (
    <>
      <OtpInput label="Código" value={value} onChange={setValue} length={6} />
      <output>{value}</output>
    </>
  )
}

describe('OtpInput', () => {
  it('aceita o código escrito dígito a dígito, com o foco a avançar sozinho', () => {
    render(<Harness />)
    screen.getByLabelText('Dígito 1 de 6').focus()
    for (const digit of '123456') {
      fireEvent.input(document.activeElement as HTMLInputElement, { target: { value: digit } })
    }
    expect(screen.getByRole('status')).toHaveTextContent('123456')
  })

  it('Backspace apaga o último dígito e recua', () => {
    render(<Harness />)
    fireEvent.input(screen.getByLabelText('Dígito 1 de 6'), { target: { value: '12' } })
    fireEvent.keyDown(screen.getByLabelText('Dígito 3 de 6'), { key: 'Backspace' })
    expect(screen.getByRole('status')).toHaveTextContent(/^1$/)
    expect(document.activeElement).toBe(screen.getByLabelText('Dígito 2 de 6'))
  })
})
