# Cómo contribuir

## Preparación

```bash
npm install
npm run dev
```

Requiere Node.js 22.13 o superior.

## Normas

- **TypeScript estricto** en todos los paquetes (`noUncheckedIndexedAccess` incluido). `npm run typecheck` debe pasar.
- **La lógica de juego va en `packages/engine`**, sin E/S ni dependencias de UI, y con pruebas. Nada de `Math.random()`: recibe un `Rng`.
- **El servidor es la autoridad.** Nunca leas saldo, rol, cartas o resultados del cliente. Valida toda entrada con Zod.
- **Dinero virtual**: cualquier cambio de saldo pasa por `applyWalletMove`/`debit`/`credit` dentro de `db.tx`, con motivo y ronda. Las rondas se liquidan con `settleRound`.
- **SQL parametrizado** siempre. Los cambios de esquema van en una nueva migración `NNN_descripcion.sql`; no se editan migraciones ya publicadas.
- **Animación**: usa los tokens de `lib/anim/tokens.ts`, anima `transform`/`opacity`, respeta el nivel de movimiento del usuario y limpia temporizadores al desmontar. Las animaciones representan resultados; no los deciden.
- **Textos** en español, en segunda persona, frases cortas. Los errores dicen qué pasó y qué hacer.
- **Bots**: siempre identificados como tales; no generan actividad ni estadísticas presentadas como humanas.
- Sin servicios de pago ni dependencias pesadas por estética. Justifica cada dependencia nueva en el PR.

## Pruebas

- `npm test` antes de cada commit; `npm run test:e2e` antes de cada versión.
- Nuevas reglas o pagos → pruebas en el motor con aleatoriedad controlada.
- Nuevas rutas → prueba de integración (validación, autorización, efecto en el libro mayor).

## Commits y ramas

- Ramas `feature/…`, `fix/…`.
- Mensajes en imperativo, describiendo el porqué.
- Actualiza `CHANGELOG.md` y, si cambia el estado del proyecto, `PROJECT_STATUS.md`.
