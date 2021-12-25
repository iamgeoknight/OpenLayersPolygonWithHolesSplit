/*
Create and Render map on div with zoom and center
*/

let regularStyle = new ol.style.Style({        
    stroke: new ol.style.Stroke({
        color: '#0e97fa',
        width:2
    }),
    fill: new ol.style.Fill({
        color: [0,0,0,0.2]
    }),
});

let highlightStyle = new ol.style.Style({
    stroke: new ol.style.Stroke({
        color: [255,0,0,0.6],
        width: 2
    }),
    fill: new ol.style.Fill({
        color: [255,0,0,0.2]
    }),
    zIndex: 1
});

class OLMap {
    //Constructor accepts html div id, zoom level and center coordinaes
    constructor(map_div, zoom, center) {
        this.map = new ol.Map({
            interactions: ol.interaction.defaults({
                doubleClickZoom: false
            }),
            target: map_div,
            layers: [
                new ol.layer.Tile({
                    source: new ol.source.OSM()
                })
            ],
            view: new ol.View({
                center: ol.proj.fromLonLat(center),
                zoom: zoom
            })
        });
    }
}


/*
Create Vector Layer
*/
class VectorLayer{
    //Constructor accepts title of vector layer and map object
    constructor(title, map) {
        this.layer = new ol.layer.Vector({
            title: title,      
            source: new ol.source.Vector({
                projection:map.getView().projection
            }),
            style: regularStyle
        });
    }
}


/*
Create overlay
*/
class Overlay {
    //Contrctor accepts map object, overlay html element, overlay offset, overlay positioning and overlay class
    constructor(map, element = document.getElementById("popup"), offset = [0, -15], positioning = 'bottom-center',   className = 'ol-tooltip-measure ol-tooltip ol-tooltip-static') {
        this.map = map;
        this.overlay = new ol.Overlay({
            element: element,
            offset: offset,
            positioning: positioning,
            className: className
        });
        this.overlay.setPosition([0,0]);
        this.overlay.element.style.display = 'block';      
        this.map.addOverlay(this.overlay);          
    }
}

/* 
Draw Intraction
*/
class Draw {  
    //Constructor accepts geometry type, map object and vector layer
    constructor(type, map, vector_layer) {
        this.type = type;
        this.vector_layer = vector_layer
        this.map = map;        
        this.interaction = new ol.interaction.Draw({
            type: type,
            stopClick: true
        });        
        if (type === "LineString") {
            this.interaction.on('drawstart', this.onDrawStart);            
        }
        else {
            this.vector_layer.getSource().clear();
        }
        this.interaction.on('drawend', this.onDrawEnd);
        this.map.addInteraction(this.interaction);
    }

    onDrawStart = (e) => {
        e.feature.getGeometry().on('change', this.onGeomChange); 
    }

    onDrawEnd = (e) => {
        this.map.getOverlays().clear();
        this.vector_layer.setStyle(regularStyle);
        this.map.removeInteraction(this.interaction);

        if(this.type === "Polygon") {
            this.vector_layer.getSource().addFeature(e.feature);
            polygon = e.feature;
        }
    }

    onGeomChange = (e) => {
        /*
            This function will dynamically split the polygon into two parts by a line and will follow geometry change event.
        */
        
        //Create jsts parser to read openlayers geometry
        let parser = new jsts.io.OL3Parser();
        
        //Creating line geometry from draw intraction
        let linestring = new ol.Feature({    
            geometry: new ol.geom.LineString(e.target.getCoordinates())
        });        
        
        //Parse Polygon and Line geomtry to jsts type
        let polygon_to_split = parser.read(polygon.getGeometry());
        let line = parser.read(linestring.getGeometry());             
        
        
        //Perform union of Polygon and Line and use Polygonizer to split the polygon by line        
        let holes = polygon_to_split._holes;
        let union = polygon_to_split.getExteriorRing().union(line);
        let polygonizer = new jsts.operation.polygonize.Polygonizer();
        
        //Splitting polygon in two part        
        polygonizer.add(union);
        
        //Get splitted polygons
        let polygons = polygonizer.getPolygons();
        
        //This will execute only if polygon is successfully splitted into two parts
        if(polygons.array.length == 2) {            
            
            //Clear old splitted polygons and measurement ovelays
            this.vector_layer.getSource().clear();
            this.map.getOverlays().clear();              
            
            polygons.array.forEach((geom) => {

                // Logic for splitting polygon with holes
                holes.forEach((hole) => {
                    let arr = []
                    for (let i in hole.getCoordinates()){
                        arr.push([hole.getCoordinates()[i].x, hole.getCoordinates()[i].y])
                    }
                    hole = parser.read(new ol.geom.Polygon([arr]));
                    geom = geom.difference(hole);
                });


                let splitted_polygon = new ol.Feature({    
                    geometry: new ol.geom.Polygon(parser.write(geom).getCoordinates())
                });                
                
                //Add splitted polygon to vector layer    
                this.vector_layer.getSource().addFeature(splitted_polygon);
                
                //Add area measurement overlay to splitted polygon
                let overlay = new Overlay(this.map).overlay;
                this.calArea(overlay, splitted_polygon.getGeometry().getFlatInteriorPoint(), splitted_polygon.getGeometry().getArea());
                
                //Add line measurement overlay to segment of polygon
                let polyCoords = splitted_polygon.getGeometry().getCoordinates()[0];
                polyCoords.forEach((coords, i) => {    
                    if(i < polyCoords.length-1){                        
                        let line = new ol.geom.LineString([coords, polyCoords[i+1]]);                        
                        let overlay = new Overlay(this.map).overlay;
                        this.calDistance(overlay, line.getFlatMidpoint(), line.getLength());    
                    }
                });
            });
            
            //Change Style of Splitted polygons
            this.vector_layer.setStyle(highlightStyle);
        }
        else {
            //Change style to normal if polgon is not splitted            
            this.vector_layer.setStyle(regularStyle);
            
            //Clear measurement overlays and splitted polygon if line is not completely intersected with polygon
            this.map.getOverlays().clear();
            this.vector_layer.getSource().clear();
            
            //Add original polygon to vector layer if no intersection is there between line and polygon
            this.vector_layer.getSource().addFeature(polygon)
        }
        
    }

    //Calculates the length of a segment and position the overlay at the midpoint of it.
    calDistance = (overlay, overlayPosition, distance) => {  
        if(parseInt(distance) == 0) {    
            overlay.setPosition([0,0]);       
        }
        else {
            overlay.setPosition(overlayPosition);      
            if (distance >= 1000) {
                overlay.element.innerHTML = '<b>' + (distance/1000).toFixed(2) + ' km</b>';
            }
            else {
                overlay.element.innerHTML = '<b>' + distance.toFixed(2) + ' m</b>';
            }
        }    
    }

    calArea = (overlay, overlayPosition, area) => {    
        if(parseInt(area) == 0) {    
            overlay.setPosition([0,0]);  
        }
        else {
            overlay.setPosition(overlayPosition);  
            if (area >= 10000) {
                overlay.element.innerHTML = '<b>' + Math.round((area / 1000000) * 100) / 100  + ' km<sup>2<sup></b>';
            }
            else {
                overlay.element.innerHTML = '<b>' + Math.round(area * 100) / 100  + ' m<sup>2<sup></b>';
            }
        }   
    }
} 


/* 
Enable snapping on a vector layer
*/
class Snapping {  
    //Constructor accepts geometry type, map object and vector layer
    constructor(map, vector_source) {
        this.map = map;  
        this.vector_source = vector_source
        this.interaction = new ol.interaction.Snap({
            source: vector_source            
        });        
        this.map.addInteraction(this.interaction);          
    }
}


//Create map and vector layer
let map = new OLMap('map', 9, [-93.9566742, 32.5697505]).map;
let vector_layer = new VectorLayer('Temp Layer', map).layer
map.addLayer(vector_layer);


let polygon = new ol.Feature({
    geometry: new ol.geom.Polygon([[[-10573192.845215201, 3862791.7734972173], [-10517913.590091638, 3906819.506454825], [-10412002.436235145, 3867683.743307469], [-10407844.269360984, 3804577.3346213656], [-10498101.116092397, 3760305.011570868], [-10584933.570893666, 3790879.8228849387], [-10573192.845215201, 3862791.7734972173]], [[-10524942.4368245, 3798269.8555756304], [-10519136.5825442, 3778191.276189599], [-10450954.753313825, 3795007.422412338], [-10460432.944821186, 3819773.0195767353], [-10524942.4368245, 3798269.8555756304]], [[-10543753.099429488, 3859944.0038188365], [-10542067.691029754, 3830168.4554235185], [-10458904.204255482, 3844538.6167411325], [-10464407.670292014, 3875419.1761683435], [-10543753.099429488, 3859944.0038188365]]])
});
vector_layer.getSource().addFeature(polygon);


//Add Interaction to map depending on your selection
let draw = null;
let btnClick = (e) => {  
    removeInteractions();
    let geomType = e.srcElement.attributes.geomtype.nodeValue;
    
    //Create interaction
    draw = new Draw(geomType, map, vector_layer);    
    if(geomType == "LineString") {
        new Snapping(map, vector_layer.getSource())
    }
}


//Remove map interactions except default interactions
let removeInteractions = () => {  
    map.getInteractions().getArray().forEach((interaction, i) => {
        if(i > 8) {
            map.removeInteraction(interaction);
        }
    });
}

//Drag feature
let dragFeature = () => {
    removeInteractions();
    map.addInteraction(new ol.interaction.Translate());
} 


//Clear vector features and overlays and remove any interaction
let clear = () => {
    removeInteractions();
    map.getOverlays().clear();
    vector_layer.getSource().clear();
}

//Bind methods to click events of buttons
let distanceMeasure = document.getElementById('btn1');
distanceMeasure.onclick = btnClick;

let areaMeasure = document.getElementById('btn2');
areaMeasure.onclick = btnClick;

let clearGraphics = document.getElementById('btn3');
clearGraphics.onclick = clear;


let drag = document.getElementById('btn4');
drag.onclick = dragFeature;
