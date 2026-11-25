// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DispensadorComida
/// @notice Vende productos de comida a precio fijo, entrega el cambio y
///         registra cada venta en un evento público.
/// @dev El contrato no conoce el mundo físico: solo puede comprobar el pago,
///      el stock y sus propias reglas. La entrega material ocurre fuera de la cadena.
contract DispensadorComida {
    struct Producto {
        string nombre;
        uint256 precio;
        uint16 stock;
        bool activo;
    }

    /// @notice Cuenta que desplegó el contrato y única autorizada para administrarlo.
    address public immutable dueno;

    /// @notice Si es true, ninguna compra puede ejecutarse.
    bool public pausado;

    /// @notice Cantidad de compras exitosas desde el despliegue.
    uint256 public totalVentas;

    /// @notice Suma histórica de los precios cobrados (no descuenta retiros).
    uint256 public totalRecaudado;

    /// @dev Candado de reentrada: 0 = libre, 1 = ejecutando.
    uint256 private _bloqueo;

    Producto[] private _productos;

    error SoloDueno(address quien);
    error MaquinaPausada();
    error ProductoInexistente(uint256 idProducto);
    error ProductoInactivo(uint256 idProducto);
    error SinStock(uint256 idProducto);
    error PagoInsuficiente(uint256 enviado, uint256 requerido);
    error PrecioInvalido();
    error CantidadInvalida();
    error NombreVacio();
    error SinGanancias();
    error EstadoSinCambios();
    error FalloAlEnviar(address destino, uint256 monto);
    error NoAceptaPagosDirectos();
    error ReentradaDetectada();

    event CompraExitosa(
        address indexed comprador,
        uint256 indexed idProducto,
        string nombre,
        uint256 pagado,
        uint256 cambio,
        uint256 stockRestante,
        uint256 ventaNumero
    );
    event ProductoRepuesto(uint256 indexed idProducto, uint16 cantidad, uint16 nuevoStock);
    event ProductoConfigurado(uint256 indexed idProducto, uint256 precio, bool activo);
    event ProductoAgregado(uint256 indexed idProducto, string nombre, uint256 precio, uint16 stock);
    event GananciasRetiradas(address indexed dueno, uint256 monto);
    event PausaCambiada(bool pausado);

    modifier soloDueno() {
        if (msg.sender != dueno) revert SoloDueno(msg.sender);
        _;
    }

    modifier cuandoActiva() {
        if (pausado) revert MaquinaPausada();
        _;
    }

    /// @dev Comprueba el candado antes de entrar y lo libera siempre al salir.
    modifier noReentrante() {
        if (_bloqueo == 1) revert ReentradaDetectada();
        _bloqueo = 1;
        _;
        _bloqueo = 0;
    }

    constructor() {
        dueno = msg.sender;

        _productos.push(Producto("Barra de granola", 0.002 ether, 12, true));
        _productos.push(Producto("Manzana", 0.001 ether, 20, true));
        _productos.push(Producto("Sándwich", 0.004 ether, 8, true));
        _productos.push(Producto("Jugo natural", 0.003 ether, 10, true));
        _productos.push(Producto("Agua", 0.001 ether, 24, true));
        _productos.push(Producto("Café", 0.002 ether, 15, true));
        _productos.push(Producto("Yogur", 0.003 ether, 9, true));
        _productos.push(Producto("Galletas", 0.0015 ether, 18, true));
        _productos.push(Producto("Ensalada", 0.005 ether, 6, true));
    }

    /// @notice Compra una unidad del producto indicado.
    /// @param idProducto Posición del producto dentro del catálogo (empieza en 0).
    /// @return cambio Wei devueltos al comprador.
    function comprar(uint256 idProducto)
        external
        payable
        cuandoActiva
        noReentrante
        returns (uint256 cambio)
    {
        Producto storage producto = _producto(idProducto);

        if (!producto.activo) revert ProductoInactivo(idProducto);
        if (producto.stock == 0) revert SinStock(idProducto);
        if (msg.value < producto.precio) {
            revert PagoInsuficiente(msg.value, producto.precio);
        }

        cambio = msg.value - producto.precio;

        // Efectos antes de la llamada externa (patrón CEI).
        producto.stock -= 1;
        totalVentas += 1;
        totalRecaudado += producto.precio;

        emit CompraExitosa(
            msg.sender,
            idProducto,
            producto.nombre,
            producto.precio,
            cambio,
            producto.stock,
            totalVentas
        );

        // Interacción: devolver el cambio. Si falla, todo se revierte.
        if (cambio > 0) {
            (bool exito, ) = msg.sender.call{value: cambio}("");
            if (!exito) revert FalloAlEnviar(msg.sender, cambio);
        }
    }

    /// @notice Agrega unidades a un producto existente.
    function reponer(uint256 idProducto, uint16 cantidad) external soloDueno {
        if (cantidad == 0) revert CantidadInvalida();
        Producto storage producto = _producto(idProducto);
        producto.stock += cantidad;
        emit ProductoRepuesto(idProducto, cantidad, producto.stock);
    }

    /// @notice Cambia el precio o el estado de venta de un producto.
    function configurarProducto(uint256 idProducto, uint256 nuevoPrecio, bool activo)
        external
        soloDueno
    {
        if (nuevoPrecio == 0) revert PrecioInvalido();
        Producto storage producto = _producto(idProducto);
        producto.precio = nuevoPrecio;
        producto.activo = activo;
        emit ProductoConfigurado(idProducto, nuevoPrecio, activo);
    }

    /// @notice Agrega un producto nuevo al final del catálogo.
    function agregarProducto(string calldata nombre, uint256 precio, uint16 stock)
        external
        soloDueno
        returns (uint256 idProducto)
    {
        if (bytes(nombre).length == 0) revert NombreVacio();
        if (precio == 0) revert PrecioInvalido();
        if (stock == 0) revert CantidadInvalida();

        _productos.push(Producto(nombre, precio, stock, true));
        idProducto = _productos.length - 1;
        emit ProductoAgregado(idProducto, nombre, precio, stock);
    }

    /// @notice Pausa o reactiva todas las ventas.
    function pausar(bool nuevoEstado) external soloDueno {
        if (pausado == nuevoEstado) revert EstadoSinCambios();
        pausado = nuevoEstado;
        emit PausaCambiada(nuevoEstado);
    }

    /// @notice Envía al dueño todo el saldo custodiado por el contrato.
    function retirarGanancias() external soloDueno noReentrante {
        uint256 monto = address(this).balance;
        if (monto == 0) revert SinGanancias();

        emit GananciasRetiradas(dueno, monto);

        (bool exito, ) = dueno.call{value: monto}("");
        if (!exito) revert FalloAlEnviar(dueno, monto);
    }

    /// @notice Devuelve el catálogo completo. Es una función view: no cuesta gas.
    function obtenerProductos() external view returns (Producto[] memory) {
        return _productos;
    }

    /// @notice Devuelve el estado general de la máquina en una sola lectura.
    function resumen()
        external
        view
        returns (
            uint256 ventas,
            uint256 recaudado,
            uint256 saldoEnCustodia,
            uint256 productosRegistrados,
            bool maquinaPausada
        )
    {
        return (totalVentas, totalRecaudado, address(this).balance, _productos.length, pausado);
    }

    /// @dev Evita que alguien envíe ETH sin identificar la compra.
    receive() external payable {
        revert NoAceptaPagosDirectos();
    }

    function _producto(uint256 idProducto) private view returns (Producto storage) {
        if (idProducto >= _productos.length) revert ProductoInexistente(idProducto);
        return _productos[idProducto];
    }
}
