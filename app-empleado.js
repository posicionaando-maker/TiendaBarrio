// app-empleado.js - Panel de empleado con actualización por archivo JSON

// ==================== CONFIGURACIÓN ====================
const DB_NAME = 'TiendaEmpleadoDB';
const DB_VERSION = 3;
const STORE_PRODUCTS = 'productos';
const STORE_SALES = 'ventas';
const STORE_CONFIG = 'configuracion';

let db = null;
let currentSale = []; // Carrito temporal
let currentView = 'ventas';

// Configuración por defecto
const DEFAULT_CONFIG = {
    jsonUrl: '',
    lastUpdate: null,
    catalogVersion: null
};

// ==================== INICIALIZAR INDEXEDDB ====================
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            console.log('✅ Base de datos abierta');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;
            
            console.log(`Actualizando DB de versión ${oldVersion} a ${DB_VERSION}`);
            
            // Store de productos
            if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
                const productStore = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
                productStore.createIndex('nombre', 'nombre');
                productStore.createIndex('categoria', 'categoria');
            }
            
            // Store de ventas
            if (!db.objectStoreNames.contains(STORE_SALES)) {
                const salesStore = db.createObjectStore(STORE_SALES, { keyPath: 'id', autoIncrement: true });
                salesStore.createIndex('fecha', 'fecha');
                salesStore.createIndex('total', 'total');
            }
            
            // Store de configuración
            if (!db.objectStoreNames.contains(STORE_CONFIG)) {
                db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
            }
        };
    });
}

// ==================== FUNCIONES DE CONFIGURACIÓN ====================
async function getConfig(key) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_CONFIG], 'readonly');
        const store = transaction.objectStore(STORE_CONFIG);
        const request = store.get(key);
        
        request.onsuccess = () => resolve(request.result ? request.result.value : null);
        request.onerror = () => reject(request.error);
    });
}

async function setConfig(key, value) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_CONFIG], 'readwrite');
        const store = transaction.objectStore(STORE_CONFIG);
        const request = store.put({ key: key, value: value });
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ==================== FUNCIONES DE PRODUCTOS ====================
async function guardarProductos(productos, version = null) {
    const transaction = db.transaction([STORE_PRODUCTS], 'readwrite');
    const store = transaction.objectStore(STORE_PRODUCTS);
    
    // Limpiar productos existentes
    store.clear();
    
    // Guardar nuevos productos
    productos.forEach(producto => {
        // Asegurar que cada producto tenga los campos necesarios
        producto.id = producto.id || Date.now() + Math.random();
        producto.categoria = producto.categoria || 'general';
        store.put(producto);
    });
    
    return new Promise((resolve, reject) => {
        transaction.oncomplete = async () => {
            // Actualizar metadatos
            await setConfig('catalogVersion', version || new Date().toISOString());
            await setConfig('lastUpdate', new Date().toISOString());
            await setConfig('totalProducts', productos.length);
            resolve();
        };
        transaction.onerror = () => reject(transaction.error);
    });
}

async function cargarProductos() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_PRODUCTS], 'readonly');
        const store = transaction.objectStore(STORE_PRODUCTS);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ==================== ACTUALIZACIÓN DESDE JSON EXTERNO ====================
async function verificarYActualizarCatalogo() {
    const jsonUrl = await getConfig('jsonUrl');
    
    if (!jsonUrl) {
        addLogEntry('⚠️ No hay URL configurada para el archivo JSON');
        mostrarNotificacion('Configura primero la URL del archivo JSON', 'warning');
        return false;
    }
    
    addLogEntry(`🔄 Verificando actualizaciones desde: ${jsonUrl}`);
    mostrarNotificacion('Verificando actualizaciones...', 'warning');
    
    try {
        // Descargar JSON con timestamp para evitar caché
        const response = await fetch(`${jsonUrl}?t=${Date.now()}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Validar estructura del JSON
        if (!data.productos || !Array.isArray(data.productos)) {
            throw new Error('Formato JSON inválido: se espera un objeto con propiedad "productos"');
        }
        
        const nuevaVersion = data.version || new Date().toISOString();
        const versionActual = await getConfig('catalogVersion');
        
        addLogEntry(`📦 Versión actual: ${versionActual || 'ninguna'}`);
        addLogEntry(`📦 Nueva versión: ${nuevaVersion}`);
        
        // Comparar versiones
        if (versionActual === nuevaVersion) {
            addLogEntry('✅ El catálogo ya está actualizado');
            mostrarNotificacion('El catálogo ya está actualizado', 'success');
            return true;
        }
        
        // Actualizar productos
        addLogEntry(`📥 Actualizando ${data.productos.length} productos...`);
        await guardarProductos(data.productos, nuevaVersion);
        
        addLogEntry(`✅ Catálogo actualizado correctamente (${data.productos.length} productos)`);
        mostrarNotificacion(`✅ Catálogo actualizado: ${data.productos.length} productos`, 'success');
        
        // Actualizar UI
        await actualizarInfoCatalogo();
        await cargarYMostrarProductos();
        await cargarInventario();
        
        return true;
        
    } catch (error) {
        console.error('Error actualizando catálogo:', error);
        addLogEntry(`❌ Error: ${error.message}`);
        mostrarNotificacion(`Error al actualizar: ${error.message}`, 'error');
        return false;
    }
}

// Forzar actualización (ignora comparación de versión)
async function forzarActualizacion() {
    addLogEntry('🔄 Forzando actualización del catálogo...');
    await setConfig('catalogVersion', null); // Resetear versión
    await verificarYActualizarCatalogo();
}

// Exportar JSON actual desde la base de datos
async function exportarJSONActual() {
    const productos = await cargarProductos();
    const version = await getConfig('catalogVersion');
    
    const exportData = {
        version: version || new Date().toISOString(),
        exportDate: new Date().toISOString(),
        totalProductos: productos.length,
        productos: productos
    };
    
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `productos_export_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    addLogEntry(`📤 Exportado JSON con ${productos.length} productos`);
    mostrarNotificacion('JSON exportado correctamente', 'success');
}

// ==================== FUNCIONES DE VENTAS ====================
async function guardarVenta(venta) {
    const transaction = db.transaction([STORE_SALES], 'readwrite');
    const store = transaction.objectStore(STORE_SALES);
    
    const ventaCompleta = {
        ...venta,
        fecha: new Date().toISOString(),
        fechaLegible: new Date().toLocaleString('es-AR')
    };
    
    const request = store.add(ventaCompleta);
    
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            addLogEntry(`💰 Venta registrada: $${venta.total} - ID: ${request.result}`);
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });
}

async function obtenerVentas(filtros = {}) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_SALES], 'readonly');
        const store = transaction.objectStore(STORE_SALES);
        const request = store.getAll();
        
        request.onsuccess = () => {
            let ventas = request.result;
            
            // Aplicar filtros
            if (filtros.startDate) {
                const start = new Date(filtros.startDate);
                ventas = ventas.filter(v => new Date(v.fecha) >= start);
            }
            if (filtros.endDate) {
                const end = new Date(filtros.endDate);
                end.setHours(23, 59, 59);
                ventas = ventas.filter(v => new Date(v.fecha) <= end);
            }
            
            // Ordenar por fecha descendente
            ventas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            resolve(ventas);
        };
        request.onerror = () => reject(request.error);
    });
}

// ==================== FUNCIONES DE INVENTARIO ====================
async function actualizarProducto(productoId, nuevosDatos) {
    const productos = await cargarProductos();
    const index = productos.findIndex(p => p.id == productoId);
    
    if (index !== -1) {
        productos[index] = { ...productos[index], ...nuevosDatos };
        await guardarProductos(productos, await getConfig('catalogVersion'));
        return true;
    }
    return false;
}

async function eliminarProducto(productoId) {
    const productos = await cargarProductos();
    const nuevosProductos = productos.filter(p => p.id != productoId);
    await guardarProductos(nuevosProductos, await getConfig('catalogVersion'));
}

async function agregarProducto(producto) {
    const productos = await cargarProductos();
    const nuevoId = Math.max(...productos.map(p => p.id), 0) + 1;
    const nuevoProducto = {
        id: nuevoId,
        ...producto
    };
    productos.push(nuevoProducto);
    await guardarProductos(productos, await getConfig('catalogVersion'));
    return nuevoProducto;
}

// ==================== RENDERIZAR UI ====================
async function cargarYMostrarProductos() {
    const productos = await cargarProductos();
    const container = document.getElementById('productsList');
    const productCount = document.getElementById('productCount');
    
    if (productCount) productCount.textContent = `${productos.length} productos`;
    
    if (!productos.length) {
        container.innerHTML = '<div class="loading">No hay productos. Actualiza el catálogo.</div>';
        return;
    }
    
    let html = '';
    productos.forEach(producto => {
        let stockClass = '';
        if (producto.stock === 0) stockClass = 'out';
        else if (producto.stock < 5) stockClass = 'low';
        
        html += `
            <div class="product-card-empleado" onclick="agregarAlCarrito(${producto.id})">
                <h4>${escapeHtml(producto.nombre)}</h4>
                <div class="product-price">$${producto.precio}</div>
                <div class="product-stock ${stockClass}">
                    ${producto.stock === 0 ? '❌ Agotado' : `📦 Stock: ${producto.stock}`}
                </div>
                <button class="btn-add-cart">➕ Agregar</button>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function renderizarCarrito() {
    const container = document.getElementById('cartItems');
    const subtotalSpan = document.getElementById('subtotal');
    const ivaSpan = document.getElementById('iva');
    const totalSpan = document.getElementById('total');
    
    if (!currentSale.length) {
        container.innerHTML = '<p class="empty-cart">No hay productos agregados</p>';
        subtotalSpan.textContent = '$0';
        ivaSpan.textContent = '$0';
        totalSpan.textContent = '$0';
        return;
    }
    
    let subtotal = 0;
    let html = '';
    
    currentSale.forEach((item, index) => {
        const itemTotal = item.precio * item.cantidad;
        subtotal += itemTotal;
        
        html += `
            <div class="cart-item">
                <div class="cart-item-info">
                    <div class="cart-item-name">${escapeHtml(item.nombre)}</div>
                    <div class="cart-item-price">$${item.precio}</div>
                </div>
                <div class="cart-item-quantity">
                    <button onclick="modificarCantidadCarrito(${index}, -1)">-</button>
                    <span>${item.cantidad}</span>
                    <button onclick="modificarCantidadCarrito(${index}, 1)">+</button>
                </div>
                <div class="cart-item-total">$${itemTotal}</div>
            </div>
        `;
    });
    
    const iva = subtotal * 0.21;
    const total = subtotal + iva;
    
    container.innerHTML = html;
    subtotalSpan.textContent = `$${subtotal}`;
    ivaSpan.textContent = `$${iva.toFixed(2)}`;
    totalSpan.textContent = `$${total.toFixed(2)}`;
}

async function cargarInventario() {
    const productos = await cargarProductos();
    const tbody = document.getElementById('inventoryBody');
    const searchInput = document.getElementById('inventorySearch');
    
    if (!tbody) return;
    
    let filteredProductos = [...productos];
    
    if (searchInput && searchInput.value) {
        const search = searchInput.value.toLowerCase();
        filteredProductos = filteredProductos.filter(p => 
            p.nombre.toLowerCase().includes(search)
        );
    }
    
    if (!filteredProductos.length) {
        tbody.innerHTML = '<tr><td colspan="6">No hay productos</td></tr>';
        return;
    }
    
    let html = '';
    filteredProductos.forEach(producto => {
        let stockClass = '';
        let stockText = '';
        
        if (producto.stock === 0) {
            stockClass = 'critical';
            stockText = 'Agotado';
        } else if (producto.stock < 5) {
            stockClass = 'low';
            stockText = `⚠️ ${producto.stock}`;
        } else {
            stockClass = 'normal';
            stockText = `${producto.stock}`;
        }
        
        html += `
            <tr>
                <td>${producto.id}</td>
                <td>${escapeHtml(producto.nombre)}</td>
                <td>$${producto.precio}</td>
                <td>
                    <span class="stock-badge ${stockClass}">${stockText}</span>
                </td>
                <td>${producto.categoria || 'general'}</td>
                <td>
                    <button class="btn-edit" onclick="editarProducto(${producto.id})">Editar</button>
                    <button class="btn-delete" onclick="eliminarProductoConfirmado(${producto.id})">Eliminar</button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

async function cargarHistorialVentas() {
    const startDate = document.getElementById('startDate')?.value;
    const endDate = document.getElementById('endDate')?.value;
    
    const filtros = {};
    if (startDate) filtros.startDate = startDate;
    if (endDate) filtros.endDate = endDate;
    
    const ventas = await obtenerVentas(filtros);
    const tbody = document.getElementById('salesHistoryBody');
    const totalSalesCount = document.getElementById('totalSalesCount');
    const totalSalesAmount = document.getElementById('totalSalesAmount');
    const avgTicket = document.getElementById('avgTicket');
    
    // Estadísticas
    const total = ventas.length;
    const montoTotal = ventas.reduce((sum, v) => sum + v.total, 0);
    const promedio = total > 0 ? montoTotal / total : 0;
    
    if (totalSalesCount) totalSalesCount.textContent = total;
    if (totalSalesAmount) totalSalesAmount.textContent = `$${montoTotal.toFixed(2)}`;
    if (avgTicket) avgTicket.textContent = `$${promedio.toFixed(2)}`;
    
    if (!ventas.length) {
        tbody.innerHTML = '<tr><td colspan="6">No hay ventas registradas</td></tr>';
        return;
    }
    
    let html = '';
    ventas.forEach(venta => {
        html += `
            <tr>
                <td>#${venta.id}</td>
                <td>${new Date(venta.fecha).toLocaleString('es-AR')}</td>
                <td>${venta.items.length} productos</td>
                <td>$${venta.total}</td>
                <td>${venta.pago || 'efectivo'}</td>
                <td>
                    <button onclick="verDetalleVenta(${venta.id})" class="btn-edit">Ver</button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

async function actualizarInfoCatalogo() {
    const version = await getConfig('catalogVersion');
    const lastUpdate = await getConfig('lastUpdate');
    const totalProducts = await getConfig('totalProducts');
    const jsonUrl = await getConfig('jsonUrl');
    
    const versionElem = document.getElementById('currentVersion');
    const lastUpdateElem = document.getElementById('lastUpdate');
    const totalProductsElem = document.getElementById('totalProducts');
    const currentUrlElem = document.getElementById('currentJsonUrl');
    const urlInput = document.getElementById('jsonUrlInput');
    
    if (versionElem) versionElem.textContent = version || 'No disponible';
    if (lastUpdateElem) lastUpdateElem.textContent = lastUpdate ? new Date(lastUpdate).toLocaleString() : 'Nunca';
    if (totalProductsElem) totalProductsElem.textContent = totalProducts || '0';
    if (currentUrlElem) currentUrlElem.textContent = jsonUrl || 'No configurada';
    if (urlInput && jsonUrl) urlInput.value = jsonUrl;
}

function addLogEntry(message) {
    const logContainer = document.getElementById('updateLog');
    if (!logContainer) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const entry = document.createElement('p');
    entry.className = 'log-entry';
    entry.textContent = `[${timestamp}] ${message}`;
    logContainer.insertBefore(entry, logContainer.firstChild);
    
    // Limitar a 50 entradas
    while (logContainer.children.length > 50) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

// ==================== FUNCIONES DEL CARRITO ====================
window.agregarAlCarrito = async function(productoId) {
    const productos = await cargarProductos();
    const producto = productos.find(p => p.id === productoId);
    
    if (!producto) {
        mostrarNotificacion('Producto no encontrado', 'error');
        return;
    }
    
    if (producto.stock <= 0) {
        mostrarNotificacion(`${producto.nombre} - Sin stock`, 'warning');
        return;
    }
    
    const existingItem = currentSale.find(item => item.id === productoId);
    
    if (existingItem) {
        if (existingItem.cantidad + 1 <= producto.stock) {
            existingItem.cantidad++;
        } else {
            mostrarNotificacion(`Stock insuficiente de ${producto.nombre}`, 'warning');
            return;
        }
    } else {
        currentSale.push({
            id: producto.id,
            nombre: producto.nombre,
            precio: producto.precio,
            cantidad: 1
        });
    }
    
    renderizarCarrito();
    mostrarNotificacion(`${producto.nombre} agregado`, 'success');
};

window.modificarCantidadCarrito = function(index, cambio) {
    if (!currentSale[index]) return;
    
    const nuevaCantidad = currentSale[index].cantidad + cambio;
    
    if (nuevaCantidad <= 0) {
        currentSale.splice(index, 1);
    } else {
        currentSale[index].cantidad = nuevaCantidad;
    }
    
    renderizarCarrito();
};

window.completarVenta = async function() {
    if (currentSale.length === 0) {
        mostrarNotificacion('No hay productos en la venta', 'warning');
        return;
    }
    
    // Verificar stock
    const productos = await cargarProductos();
    let stockValido = true;
    
    for (const item of currentSale) {
        const producto = productos.find(p => p.id === item.id);
        if (!producto || item.cantidad > producto.stock) {
            mostrarNotificacion(`Stock insuficiente de ${item.nombre}`, 'error');
            stockValido = false;
            break;
        }
    }
    
    if (!stockValido) return;
    
    // Calcular total
    const subtotal = currentSale.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
    const iva = subtotal * 0.21;
    const total = subtotal + iva;
    
    // Actualizar stock
    for (const item of currentSale) {
        const producto = productos.find(p => p.id === item.id);
        producto.stock -= item.cantidad;
    }
    
    await guardarProductos(productos, await getConfig('catalogVersion'));
    
    // Guardar venta
    const pago = document.getElementById('paymentMethod')?.value || 'efectivo';
    const venta = {
        items: [...currentSale],
        subtotal: subtotal,
        iva: iva,
        total: total,
        pago: pago
    };
    
    await guardarVenta(venta);
    
    // Limpiar carrito
    currentSale = [];
    renderizarCarrito();
    
    // Actualizar interfaces
    await cargarYMostrarProductos();
    await cargarInventario();
    await cargarHistorialVentas();
    
    mostrarNotificacion(`✅ Venta completada: $${total.toFixed(2)}`, 'success');
    addLogEntry(`💰 Venta completada: $${total.toFixed(2)}`);
};

// ==================== FUNCIONES DE INVENTARIO UI ====================
window.editarProducto = async function(productoId) {
    const productos = await cargarProductos();
    const producto = productos.find(p => p.id === productoId);
    
    if (!producto) return;
    
    document.getElementById('modalTitle').textContent = 'Editar Producto';
    document.getElementById('editProductId').value = producto.id;
    document.getElementById('editProductName').value = producto.nombre;
    document.getElementById('editProductPrice').value = producto.precio;
    document.getElementById('editProductStock').value = producto.stock;
    document.getElementById('editProductCategory').value = producto.categoria || 'general';
    
    document.getElementById('productModal').classList.remove('hidden');
};

window.guardarProductoEditado = async function() {
    const id = parseInt(document.getElementById('editProductId').value);
    const nombre = document.getElementById('editProductName').value;
    const precio = parseFloat(document.getElementById('editProductPrice').value);
    const stock = parseInt(document.getElementById('editProductStock').value);
    const categoria = document.getElementById('editProductCategory').value;
    
    if (!nombre || isNaN(precio) || isNaN(stock)) {
        mostrarNotificacion('Complete todos los campos', 'error');
        return;
    }
    
    await actualizarProducto(id, { nombre, precio, stock, categoria });
    await cargarInventario();
    await cargarYMostrarProductos();
    
    document.getElementById('productModal').classList.add('hidden');
    mostrarNotificacion('Producto actualizado', 'success');
    addLogEntry(`✏️ Producto "${nombre}" actualizado`);
};

window.eliminarProductoConfirmado = async function(productoId) {
    if (confirm('¿Eliminar este producto permanentemente?')) {
        await eliminarProducto(productoId);
        await cargarInventario();
        await cargarYMostrarProductos();
        mostrarNotificacion('Producto eliminado', 'success');
        addLogEntry(`🗑️ Producto ID ${productoId} eliminado`);
    }
};

window.agregarNuevoProducto = async function() {
    document.getElementById('modalTitle').textContent = 'Nuevo Producto';
    document.getElementById('editProductId').value = '';
    document.getElementById('editProductName').value = '';
    document.getElementById('editProductPrice').value = '';
    document.getElementById('editProductStock').value = '';
    document.getElementById('editProductCategory').value = 'general';
    
    document.getElementById('productModal').classList.remove('hidden');
};

window.guardarNuevoProducto = async function() {
    const nombre = document.getElementById('editProductName').value;
    const precio = parseFloat(document.getElementById('editProductPrice').value);
    const stock = parseInt(document.getElementById('editProductStock').value);
    const categoria = document.getElementById('editProductCategory').value;
    
    if (!nombre || isNaN(precio) || isNaN(stock)) {
        mostrarNotificacion('Complete todos los campos', 'error');
        return;
    }
    
    await agregarProducto({ nombre, precio, stock, categoria });
    await cargarInventario();
    await cargarYMostrarProductos();
    
    document.getElementById('productModal').classList.add('hidden');
    mostrarNotificacion('Producto agregado', 'success');
    addLogEntry(`➕ Nuevo producto: "${nombre}"`);
};

// ==================== REPORTES ====================
async function generarReporte(tipo) {
    const ventas = await obtenerVentas();
    const productos = await cargarProductos();
    
    switch(tipo) {
        case 'daily':
            const hoy = new Date().toISOString().split('T')[0];
            const ventasHoy = ventas.filter(v => v.fecha.split('T')[0] === hoy);
            mostrarReporte('Reporte Diario', ventasHoy, productos);
            break;
            
        case 'weekly':
            const semana = new Date();
            semana.setDate(semana.getDate() - 7);
            const ventasSemana = ventas.filter(v => new Date(v.fecha) >= semana);
            mostrarReporte('Reporte Semanal', ventasSemana, productos);
            break;
            
        case 'monthly':
            const mes = new Date();
            mes.setMonth(mes.getMonth() - 1);
            const ventasMes = ventas.filter(v => new Date(v.fecha) >= mes);
            mostrarReporte('Reporte Mensual', ventasMes, productos);
            break;
            
        case 'products':
            const ventasPorProducto = {};
            ventas.forEach(venta => {
                venta.items.forEach(item => {
                    if (!ventasPorProducto[item.nombre]) {
                        ventasPorProducto[item.nombre] = { cantidad: 0, total: 0 };
                    }
                    ventasPorProducto[item.nombre].cantidad += item.cantidad;
                    ventasPorProducto[item.nombre].total += item.precio * item.cantidad;
                });
            });
            const topProducts = Object.entries(ventasPorProducto)
                .sort((a,b) => b[1].cantidad - a[1].cantidad)
                .slice(0, 10);
            mostrarTopProductos(topProducts);
            break;
            
        case 'stock':
            const stockBajo = productos.filter(p => p.stock < 5);
            mostrarStockBajo(stockBajo);
            break;
            
        case 'export':
            exportarTodo(ventas, productos);
            break;
    }
}

function mostrarReporte(titulo, ventas, productos) {
    const totalVentas = ventas.length;
    const montoTotal = ventas.reduce((sum, v) => sum + v.total, 0);
    const productosVendidos = ventas.reduce((sum, v) => sum + v.items.length, 0);
    
    alert(`${titulo}\n\n` +
          `📊 Ventas realizadas: ${totalVentas}\n` +
          `💰 Monto total: $${montoTotal.toFixed(2)}\n` +
          `📦 Productos vendidos: ${productosVendidos}\n` +
          `💵 Ticket promedio: $${(montoTotal/totalVentas || 0).toFixed(2)}`);
}

function mostrarTopProductos(topProducts) {
    let mensaje = '🏆 TOP 10 PRODUCTOS MÁS VENDIDOS\n\n';
    topProducts.forEach(([nombre, data], i) => {
        mensaje += `${i+1}. ${nombre}\n   Cantidad: ${data.cantidad} | Total: $${data.total}\n\n`;
    });
    alert(mensaje);
}

function mostrarStockBajo(stockBajo) {
    if (stockBajo.length === 0) {
        alert('✅ Todos los productos tienen stock suficiente');
        return;
    }
    
    let mensaje = '⚠️ PRODUCTOS CON STOCK BAJO (<5 unidades)\n\n';
    stockBajo.forEach(p => {
        mensaje += `• ${p.nombre}: ${p.stock} unidades\n`;
    });
    alert(mensaje);
}

function exportarTodo(ventas, productos) {
    const exportData = {
        exportDate: new Date().toISOString(),
        ventas: ventas,
        productos: productos,
        estadisticas: {
            totalVentas: ventas.length,
            totalProductos: productos.length,
            montoTotal: ventas.reduce((sum, v) => sum + v.total, 0)
        }
    };
    
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_completo_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    
    mostrarNotificacion('Backup exportado correctamente', 'success');
}

// ==================== NAVEGACIÓN ====================
function cambiarVista(view) {
    // Ocultar todas las vistas
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${view}View`).classList.add('active');
    
    // Actualizar navegación
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector(`[data-view="${view}"]`).classList.add('active');
    
    currentView = view;
    
    // Cargar datos según la vista
    switch(view) {
        case 'inventario':
            cargarInventario();
            break;
        case 'historial':
            cargarHistorialVentas();
            break;
        case 'actualizar':
            actualizarInfoCatalogo();
            break;
    }
}

// ==================== NOTIFICACIONES ====================
function mostrarNotificacion(mensaje, tipo = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = mensaje;
    notification.className = `notification ${tipo}`;
    notification.classList.remove('hidden');
    
    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}

// ==================== UTILIDADES ====================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== INICIALIZACIÓN ====================
async function initApp() {
    await initDB();
    
    // Cargar configuración guardada
    const savedUrl = await getConfig('jsonUrl');
    if (savedUrl) {
        const urlInput = document.getElementById('jsonUrlInput');
        if (urlInput) urlInput.value = savedUrl;
    }
    
    // Cargar productos
    let productos = await cargarProductos();
    if (productos.length === 0) {
        addLogEntry('📦 No hay productos en la base de datos');
        addLogEntry('💡 Configura la URL del JSON y presiona "Verificar actualizaciones"');
    } else {
        addLogEntry(`📦 ${productos.length} productos cargados desde base local`);
    }
    
    await cargarYMostrarProductos();
    await cargarInventario();
    await cargarHistorialVentas();
    await actualizarInfoCatalogo();
    
    // Configurar eventos
    document.getElementById('completeSaleBtn')?.addEventListener('click', completarVenta);
    document.getElementById('clearCartBtn')?.addEventListener('click', () => {
        currentSale = [];
        renderizarCarrito();
    });
    
    document.getElementById('saveUrlBtn')?.addEventListener('click', async () => {
        const url = document.getElementById('jsonUrlInput').value;
        if (url) {
            await setConfig('jsonUrl', url);
            await actualizarInfoCatalogo();
            addLogEntry(`📡 URL configurada: ${url}`);
            mostrarNotificacion('URL guardada correctamente', 'success');
        }
    });
    
    document.getElementById('checkUpdateBtn')?.addEventListener('click', verificarYActualizarCatalogo);
    document.getElementById('forceUpdateBtn')?.addEventListener('click', forzarActualizacion);
    document.getElementById('exportLocalJsonBtn')?.addEventListener('click', exportarJSONActual);
    document.getElementById('clearLogBtn')?.addEventListener('click', () => {
        const logContainer = document.getElementById('updateLog');
        if (logContainer) logContainer.innerHTML = '<p class="log-entry">📋 Log limpiado</p>';
    });
    
    document.getElementById('addProductBtn')?.addEventListener('click', agregarNuevoProducto);
    document.getElementById('saveProductBtn')?.addEventListener('click', () => {
        const id = document.getElementById('editProductId').value;
        if (id) {
            guardarProductoEditado();
        } else {
            guardarNuevoProducto();
        }
    });
    
    document.getElementById('filterSalesBtn')?.addEventListener('click', cargarHistorialVentas);
    
    document.getElementById('inventorySearch')?.addEventListener('input', cargarInventario);
    document.getElementById('productSearch')?.addEventListener('input', (e) => {
        // Implementar búsqueda en tiempo real
        const search = e.target.value.toLowerCase();
        const productos = document.querySelectorAll('.product-card-empleado');
        productos.forEach(card => {
            const title = card.querySelector('h4')?.textContent.toLowerCase();
            if (title && title.includes(search)) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    });
    
    // Eventos de navegación
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            if (view) cambiarVista(view);
        });
    });
    
    // Eventos de reportes
    document.querySelectorAll('.report-card').forEach(card => {
        card.addEventListener('click', () => {
            const reportType = card.dataset.report;
            if (reportType) generarReporte(reportType);
        });
    });
    
    // Cerrar modal
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('productModal').classList.add('hidden');
        });
    });
    
    // Estado de conexión
    window.addEventListener('online', () => {
        document.getElementById('connectionText').textContent = 'Conectado';
        document.getElementById('syncStatus')?.classList.remove('offline');
        addLogEntry('🌐 Conexión restablecida');
    });
    window.addEventListener('offline', () => {
        document.getElementById('connectionText').textContent = 'Offline';
        document.getElementById('syncStatus')?.classList.add('offline');
        addLogEntry('📴 Modo offline - trabajando con datos locales');
    });
    
    addLogEntry('🚀 Aplicación iniciada correctamente');
}

// Exponer funciones globales
window.agregarAlCarrito = agregarAlCarrito;
window.modificarCantidadCarrito = modificarCantidadCarrito;
window.completarVenta = completarVenta;
window.editarProducto = editarProducto;
window.eliminarProductoConfirmado = eliminarProductoConfirmado;
window.verDetalleVenta = (id) => {
    mostrarNotificacion(`Ver detalle de venta #${id}`, 'info');
};

// Iniciar
document.addEventListener('DOMContentLoaded', initApp);
