# Bocadito 24/7

Dispensadora de comida con un contrato inteligente. Eliges un producto, pagas con ether de prueba y el contrato decide si entrega, cuánto cambio devuelve y cuánto stock queda.

La interfaz funciona de dos maneras:

- **Modo demo:** todo ocurre en la página. No necesitas wallet, nodo ni instalar nada más. También puedes actuar como dueño y probar la reposición de stock y el retiro de ganancias.
- **Modo real local:** el contrato se despliega en Hardhat y las compras y acciones del dueño se firman con MetaMask.

---

## Inicio rápido

Requisitos: Node.js 20 o superior.

```bash
npm install
npm test
```

Para abrir la interfaz:

```bash
npm run web
```

Luego visita **http://localhost:5173/web/**. La página abre en modo demo con 0,15 ETH de prueba y seis productos.

---

## Probar el contrato en una red local

### 1. Inicia la red

En una terminal:

```bash
npm run node
```

Deja esa terminal abierta. Hardhat muestra varias cuentas de práctica y sus llaves privadas.

### 2. Despliega el contrato

En otra terminal:

```bash
npm run deploy:local
```

El script guarda la dirección, el ABI y el dueño en `web/contract-config.js`. Si vuelves a desplegar, ese archivo se actualiza.

### 3. Abre la página y conecta MetaMask

```bash
npm run web
```

En MetaMask agrega la red:

| Campo | Valor |
|---|---|
| Nombre | Hardhat local |
| RPC | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Moneda | ETH |

Importa una de las llaves privadas que imprimió `npm run node`. La cuenta 0 es la dueña del contrato; cualquier otra cuenta puede comprar. **Nunca uses llaves privadas con fondos reales.**

Haz clic en **Conectar MetaMask** y confirma la compra. La interfaz leerá el stock real del contrato y esperará el recibo de la transacción.

> Para volver a la simulación, usa **Volver a demo**.

---

## Cómo funciona una compra

```
Cliente elige producto
        │
        ▼
Llama comprar(id) y adjunta msg.value
        │
        ├── ¿Hay stock? ─────────── no ──► revert SinStock
        │
        ├── ¿Pago ≥ precio? ─────── no ──► revert PagoInsuficiente
        │
        ▼
stock − 1 · ventas + 1 · evento Compra
        │
        ▼
Devuelve el cambio y entrega el producto
```

La entrega física no la puede comprobar el contrato. El contrato garantiza el cobro, el cambio, el stock y el registro; la bandeja y el producto son parte de la máquina.

---

## Modo dueño

La sección **Dueño** permite:

- **Reponer +5 unidades** de cualquier producto.
- **Retirar las ganancias** que el contrato tiene en custodia.
- Ver las ventas realizadas, las unidades disponibles y el saldo acumulado.

En **modo demo** las acciones son simuladas y puedes probarlas sin wallet.

En **modo real**, el contrato comprueba que `msg.sender` sea la cuenta que lo desplegó. Si conectas otra cuenta, la interfaz muestra **Solo lectura** y desactiva los botones; si alguien intenta llamar igualmente, el contrato revierte con `SoloDueno`.

| Acción | Función del contrato | Quién puede |
|---|---|---|
| Reponer stock | `reponer(id, cantidad)` | Solo el dueño |
| Retirar ganancias | `retirar()` | Solo el dueño |
| Comprar | `comprar(id)` | Cualquier cuenta |

El retiro envía **todo** el saldo custodiado a la cuenta dueña. Después del retiro, el saldo del contrato vuelve a cero.

---

## Productos

| # | Producto | Precio | Stock inicial |
|---|---|---|---|
| 0 | Empanada | 0.002 ETH | 10 |
| 1 | Arepa de queso | 0.003 ETH | 8 |
| 2 | Mango | 0.001 ETH | 12 |
| 3 | Chocolate | 0.0015 ETH | 15 |
| 4 | Papas | 0.002 ETH | 9 |
| 5 | Limonada | 0.0025 ETH | 7 |

Puedes cambiar el menú en dos lugares:

1. El constructor de `contracts/DispensadorComida.sol`.
2. El arreglo `CATALOGO` de `web/app.js`, que alimenta el modo demo.

Mantén ambos sincronizados. En modo real, los productos y precios siempre se leen del contrato.

---

## Reglas del contrato

| Regla | Dónde se comprueba |
|---|---|
| No vender sin stock | `comprar()` |
| No aceptar un pago menor al precio | `comprar()` |
| Devolver el cambio en la misma transacción | `comprar()` |
| Registrar cada venta con un evento | `event Compra` |
| Solo el dueño repone stock | `reponer()` |
| Solo el dueño retira lo recaudado | `retirar()` |
| Rechazar ETH enviado sin una compra | `receive()` |

Errores personalizados: `PagoInsuficiente`, `SinStock`, `ProductoInexistente`, `SoloDueno`, `CantidadInvalida`, `SinGanancias`, `FalloAlEnviar` y `NoAceptaPagosDirectos`.

La función `comprar()` actualiza el stock y la venta **antes** de enviar el cambio. Ese orden se conoce como **CEI** (Comprobar, Efectuar, Interactuar) y evita que una llamada externa vea un estado a medias.

---

## Pruebas

```bash
npm test
```

Las 10 pruebas cubren:

1. Despliegue con seis productos y el dueño correcto.
2. Compra con pago exacto, stock y evento.
3. Devolución del cambio.
4. Pago insuficiente sin alterar el stock.
5. Producto agotado.
6. Transferencias directas rechazadas.
7. Producto inexistente.
8. Permisos de administración.
9. Reposición de stock y cantidad inválida.
10. Retiro de ganancias y segundo retiro sin saldo.

Salida esperada: `10 passing`.

---

## Estructura del proyecto

```
.
├─ contracts/
│  └─ DispensadorComida.sol     Contrato y menú
├─ scripts/
│  └─ deploy.js                 Despliegue + configuración web
├─ test/
│  └─ DispensadorComida.test.js 10 pruebas
├─ web/
│  ├─ index.html                Interfaz
│  ├─ styles.css                Diseño cálido de cafetería
│  ├─ app.js                    Demo + conexión con MetaMask
│  ├─ contract-config.js        Generado al desplegar (se ignora en git)
│  └─ contract-config.example.js
├─ hardhat.config.js
├─ package.json
└─ README.md
```

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Compila y ejecuta las pruebas |
| `npm run node` | Inicia Hardhat local en `127.0.0.1:8545` |
| `npm run deploy:local` | Despliega y escribe `web/contract-config.js` |
| `npm run web` | Sirve el proyecto en `http://localhost:5173/web/` |
| `npm run compile` | Solo compila el contrato |

---

## Problemas frecuentes

**La página dice “Solo demo” o “Contrato sin desplegar”.**
No existe `web/contract-config.js` o está vacío. Inicia `npm run node`, ejecuta `npm run deploy:local` y recarga.

**MetaMask está en otra red.**
La interfaz intenta cambiar a la red 31337. Si no existe, MetaMask pedirá agregarla. Revisa que el RPC sea `http://127.0.0.1:8545` y que el nodo siga abierto.

**La compra se queda en “Procesando…”.**
Confirma la transacción en MetaMask. Si rechazas la firma, la interfaz vuelve al estado anterior sin descontar nada.

**El stock real no se reinicia.**
El modo demo tiene su propio botón **Reiniciar demo**. En la red, usa el botón **+5** del panel Dueño o llama `reponer()`; para volver al stock inicial, despliega otra vez el contrato.

**Abrí `index.html` con doble clic y no carga la configuración.**
Es normal. Usa `npm run web` para servirlo por HTTP y permitir que el navegador lea los archivos del proyecto.

---

## Límites y decisión de diseño

- La cadena no puede ver la bandeja ni confirmar que la comida salió. Para eso haría falta un sensor o un oráculo.
- Cada escritura en una red real cuesta gas; aquí se usa una red local con fondos de práctica.
- La interfaz incluye un panel de dueño para reponer stock y retirar ganancias. El permiso no depende de la interfaz: el contrato lo verifica con el modificador `soloDueno`.
- Si el proyecto fuera solo un inventario interno, PostgreSQL sería más simple y barato. El contrato aporta valor porque varias partes necesitan verificar pagos, stock y reglas sin un administrador que pueda cambiarlas a mitad de la compra.

---

Hecho para el **Aula ADSO · Dinero programable**.  
Referencia: [dp.artnati.org/web](https://dp.artnati.org/web/index.html)
