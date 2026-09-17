-- =====================================================================
--  MOVA Gestión — Carga de productos reales (movaelectronica.com.ar)
--  precio_venta = precio de lista (tachado en la web)
--  descuento_monto = diferencia hasta el precio con descuento mostrado
--  => precio final del sistema = precio actual de la web
--  costo_unitario = 0 (la web no publica costo; completar luego)
--  stock = 10 de arranque, stock_minimo = 5
-- =====================================================================

insert into public.productos_servicios
  (tipo, nombre, categoria, proveedor, unidad, precio_venta, costo_unitario, stock, stock_minimo, aplica_descuento, descuento_pct, descuento_monto, activo)
values
  ('producto','Termostato Smart Programable Losa Radiante Wifi - Tuya Smart Life','Sensores y controladores','Tuya / SmartLife','unidad',99999,0,10,5,true,0,5000,true),
  ('producto','Panel 2 Teclas + Hub Zigbee + Alexa Smartlife Tuya','Kits','Tuya / SmartLife','unidad',499999,0,10,5,true,0,5000,true),
  ('producto','Tecla de Pared Smart 1 Modulo Zigbee Glass Touch - Tuya','Módulos y llaves','Tuya / SmartLife','unidad',49999,0,10,5,true,0,2500,true),
  ('producto','Tecla de Pared Smart 2 Modulos Zigbee Glass Touch - Tuya','Módulos y llaves','Tuya / SmartLife','unidad',52999,0,10,5,true,0,2650,true),
  ('producto','Tecla de Pared Smart 3 Modulos Zigbee Glass Touch - Tuya','Módulos y llaves','Tuya / SmartLife','unidad',54999,0,10,5,true,0,2750,true),
  ('producto','Tecla de Pared Smart 1 Modulo Zigbee Soft Touch - Tuya','Módulos y llaves','Tuya / SmartLife','unidad',49999,0,10,5,true,0,5000,true),
  ('producto','Tecla de Pared Smart 2 Modulos Zigbee Soft Touch - Tuya','Módulos y llaves','Tuya / SmartLife','unidad',54999,0,10,5,true,0,5000,true),
  ('producto','Tecla de Pared Smart 3 Modulos Zigbee Soft Touch - Tuya','Módulos y llaves','Tuya / SmartLife','unidad',59999,0,10,5,true,0,5000,true),
  ('producto','Tecla de Pared Touch 1 Modulo sin Neutro Zigbee Smartlife / Tuya Linea GR','Módulos y llaves','Tuya / SmartLife','unidad',44000,0,10,5,true,0,10500,true),
  ('producto','Tecla de Pared Touch 2 Modulos sin Neutro Zigbee Smartlife / Tuya Linea GR','Módulos y llaves','Tuya / SmartLife','unidad',48000,0,10,5,true,0,14000,true),
  ('producto','Tecla de Pared Touch 3 Modulos sin Neutro Zigbee Smartlife / Tuya Linea GR','Módulos y llaves','Tuya / SmartLife','unidad',52000,0,10,5,true,0,10000,true),
  ('producto','Tecla de Pared Touch 4 Modulos sin Neutro Zigbee Smartlife / Tuya Linea GR','Módulos y llaves','Tuya / SmartLife','unidad',58000,0,10,5,true,0,13000,true),
  ('producto','Tecla de Pared Touch 1 Modulo sin Neutro Wifi+RF Smartlife / Tuya','Módulos y llaves','Tuya / SmartLife','unidad',36400,0,10,5,true,0,12400,true),
  ('producto','Tecla de Pared Touch 2 Modulos sin Neutro Wifi+RF Smartlife / Tuya','Módulos y llaves','Tuya / SmartLife','unidad',41600,0,10,5,true,0,11600,true),
  ('producto','Tecla de Pared Touch 3 Modulos sin Neutro Wifi+RF Smartlife / Tuya Linea Corona','Módulos y llaves','Tuya / SmartLife','unidad',44200,0,10,5,true,0,12200,true),
  ('producto','Tecla de Pared Touch 4 Modulos sin Neutro Wifi+RF Smartlife / Tuya','Módulos y llaves','Tuya / SmartLife','unidad',49000,0,10,5,true,0,14000,true),
  ('producto','Guirnalda Kermesse 10 Focos Luz Solar Alambre Cálida Multicolor','Iluminación LED','Genérico','unidad',68000,0,10,5,true,0,10000,true),
  ('producto','Guirnalda Kermesse 10 Focos Luz Cálida Multicolor Solar 6mts','Iluminación LED','Genérico','unidad',68000,0,10,5,true,0,10000,true),
  ('producto','Guirnalda Kermesse 10 Focos Vintage Luz Cálida Solar 6,5 mts','Iluminación LED','Genérico','unidad',68000,0,10,5,true,0,10000,true),
  ('producto','Guirnalda Lámpara 10 Focos Fuego Luz Cálida Solar 6mts Exterior','Iluminación LED','Genérico','unidad',68000,0,10,5,true,0,10000,true),
  ('producto','Guirnalda Flor Solar 7m Luz Led 50 Exterior Navidad','Iluminación LED','Genérico','unidad',25000,0,10,5,true,0,3500,true),
  ('producto','Guirnalda Flor Solar 7m Luz Led 50 Exterior Navidad Cálidas','Iluminación LED','Genérico','unidad',25000,0,10,5,true,0,3500,true),
  ('producto','Guirnalda Flor Cerezo Blanco Frío 50 Led 5m + 2m Panel Solar','Iluminación LED','Genérico','unidad',25000,0,10,5,true,0,3500,true),
  ('producto','Guirnalda Luces Exterior Solares Led Bolitas Cristal 30 Led','Iluminación LED','Genérico','unidad',17500,0,10,5,true,0,1000,true),
  ('producto','Guirnalda 200 Luces Led Solar Estaca 20 Metros Cálida','Iluminación LED','Genérico','unidad',30000,0,10,5,true,0,2941,true);
