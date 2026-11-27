// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Bocadito 24/7
/// @notice Una dispensadora sencilla: vende productos con stock y precio fijo,
///         devuelve el cambio y permite al dueño reponer o retirar lo recaudado.
contract DispensadorComida {
    struct Producto {
        string nombre;
        uint256 precio;
        uint8 stock;
    }

    address public immutable dueno;
    uint256 public ventas;

    Producto[] private _productos;

    error SoloDueno(address cuenta);
    error ProductoInexistente(uint256 idProducto);
    error SinStock(uint256 idProducto);
    error PagoInsuficiente(uint256 enviado, uint256 requerido);
    error CantidadInvalida();
    error SinGanancias();
    error FalloAlEnviar(address destino, uint256 monto);
    error NoAceptaPagosDirectos();

    event Compra(
        address indexed comprador,
        uint256 indexed idProducto,
        string nombre,
        uint256 precio,
        uint256 cambio,
        uint8 stockRestante,
        uint256 numeroVenta
    );
    event Reposicion(uint256 indexed idProducto, uint8 cantidad, uint8 nuevoStock);
    event Retiro(address indexed dueno, uint256 monto);

    modifier soloDueno() {
        if (msg.sender != dueno) revert SoloDueno(msg.sender);
        _;
    }

    constructor() {
        dueno = msg.sender;

        _productos.push(Producto(unicode"Empanada", 0.002 ether, 10));
        _productos.push(Producto(unicode"Arepa de queso", 0.003 ether, 8));
        _productos.push(Producto(unicode"Mango", 0.001 ether, 12));
        _productos.push(Producto(unicode"Chocolate", 0.0015 ether, 15));
        _productos.push(Producto(unicode"Papas", 0.002 ether, 9));
        _productos.push(Producto(unicode"Limonada", 0.0025 ether, 7));
    }

    /// @notice Compra una unidad. Si el pago sobra, devuelve el cambio.
    function comprar(uint256 idProducto) external payable returns (uint256 cambio) {
        Producto storage producto = _buscar(idProducto);

        if (producto.stock == 0) revert SinStock(idProducto);
        if (msg.value < producto.precio) {
            revert PagoInsuficiente(msg.value, producto.precio);
        }

        cambio = msg.value - producto.precio;

        // Primero se actualiza el estado y después se envía el cambio (CEI).
        producto.stock -= 1;
        ventas += 1;

        emit Compra(
            msg.sender,
            idProducto,
            producto.nombre,
            producto.precio,
            cambio,
            producto.stock,
            ventas
        );

        if (cambio > 0) {
            (bool exito, ) = msg.sender.call{value: cambio}("");
            if (!exito) revert FalloAlEnviar(msg.sender, cambio);
        }
    }

    /// @notice Agrega unidades a un producto. Solo el dueño.
    function reponer(uint256 idProducto, uint8 cantidad) external soloDueno {
        if (cantidad == 0) revert CantidadInvalida();
        Producto storage producto = _buscar(idProducto);
        producto.stock += cantidad;
        emit Reposicion(idProducto, cantidad, producto.stock);
    }

    /// @notice Envía al dueño todo el saldo que custodia el contrato.
    function retirar() external soloDueno {
        uint256 monto = address(this).balance;
        if (monto == 0) revert SinGanancias();

        emit Retiro(dueno, monto);

        (bool exito, ) = dueno.call{value: monto}("");
        if (!exito) revert FalloAlEnviar(dueno, monto);
    }

    /// @notice Catálogo completo. Es una lectura y no cuesta gas.
    function obtenerProductos() external view returns (Producto[] memory) {
        return _productos;
    }

    /// @notice Rechaza ETH enviado sin llamar a comprar().
    receive() external payable {
        revert NoAceptaPagosDirectos();
    }

    function _buscar(uint256 idProducto) private view returns (Producto storage) {
        if (idProducto >= _productos.length) revert ProductoInexistente(idProducto);
        return _productos[idProducto];
    }
}
