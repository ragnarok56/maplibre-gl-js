import {describe, test, expect, vi, Mock} from 'vitest';
import {type SymbolProjectionContext, type ProjectionSyntheticVertexArgs, findOffsetIntersectionPoint, projectWithMatrix, transformToOffsetNormal, projectLineVertexToLabelPlane, getPitchedLabelPlaneMatrix, getGlCoordMatrix, getTileSkewVectors, updateLineLabels, placeGlyphAlongLine} from './projection';

import Point from '@mapbox/point-geometry';
import {mat4} from 'gl-matrix';
import {SymbolLineVertexArray} from '../data/array_types.g';
import {MercatorTransform} from '../geo/projection/mercator_transform';
import {expectToBeCloseToArray} from '../util/test/util';
import { Painter, RenderOptions } from '../render/painter';
import { ProjectionData } from '../geo/projection/projection_data';
import { IReadonlyTransform } from '../geo/transform_interface';
import { SymbolLayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { SymbolStyleLayer } from '../style/style_layer/symbol_style_layer';
import { ZoomHistory } from '../style/zoom_history';
import { EvaluationParameters } from '../style/evaluation_parameters';
import { OverscaledTileID } from '../source/tile_id';
import { Program } from '../render/program';
import { SymbolBucket } from '../data/bucket/symbol_bucket';
import { Tile } from '../source/tile';
import { SourceCache } from '../source/source_cache';
import { MercatorProjection } from '../geo/projection/mercator';
import { Style } from '../style/style';
import { pixelsToTileUnits } from '../source/pixels_to_tile_units';
import { translatePosition } from '../util/util';
import type {Map} from '../ui/map';

describe('Projection', () => {
    test('matrix float precision', () => {
        const point = new Point(10.000000005, 0);
        const matrix = mat4.create();
        expect(projectWithMatrix(point.x, point.y, matrix).point.x).toBeCloseTo(point.x, 10);
    });
});

describe('Vertex to viewport projection', () => {
    // A three point line along the x axis
    const lineVertexArray = new SymbolLineVertexArray();
    lineVertexArray.emplaceBack(-10, 0, -10);
    lineVertexArray.emplaceBack(0, 0, 0);
    lineVertexArray.emplaceBack(10, 0, 10);
    const transform = new MercatorTransform();

    test('projecting with null matrix', () => {
        const projectionContext: SymbolProjectionContext = {
            projectionCache: {projections: {}, offsets: {}, cachedAnchorPoint: undefined, anyProjectionOccluded: false},
            lineVertexArray,
            pitchedLabelPlaneMatrix: mat4.create(),
            getElevation: (_x, _y) => 0,
            // Only relevant in "behind the camera" case, can't happen with null projection matrix
            tileAnchorPoint: new Point(0, 0),
            pitchWithMap: true,
            unwrappedTileID: null,
            transform,
            width: 1,
            height: 1,
            translation: [0, 0]
        };

        const syntheticVertexArgs: ProjectionSyntheticVertexArgs = {
            distanceFromAnchor: 0,
            previousVertex: new Point(0, 0),
            direction: 1,
            absOffsetX: 0
        };

        const first = projectLineVertexToLabelPlane(0, projectionContext, syntheticVertexArgs);
        const second = projectLineVertexToLabelPlane(1, projectionContext, syntheticVertexArgs);
        const third = projectLineVertexToLabelPlane(2, projectionContext, syntheticVertexArgs);
        expect(first.x).toBeCloseTo(-10);
        expect(second.x).toBeCloseTo(0);
        expect(third.x).toBeCloseTo(10);
    });
});

describe('Find offset line intersections', () => {
    const lineVertexArray = new SymbolLineVertexArray();
    // A three point line along x axis, to origin, and then up y axis
    lineVertexArray.emplaceBack(-10, 0, -10);
    lineVertexArray.emplaceBack(0, 0, 0);
    lineVertexArray.emplaceBack(0, 10, 10);

    // A three point line along the x axis
    lineVertexArray.emplaceBack(-10, 0, -10);
    lineVertexArray.emplaceBack(0, 0, 0);
    lineVertexArray.emplaceBack(10, 0, 10);
    const transform = new MercatorTransform();

    const projectionContext: SymbolProjectionContext = {
        projectionCache: {projections: {}, offsets: {}, cachedAnchorPoint: undefined, anyProjectionOccluded: false},
        lineVertexArray,
        pitchedLabelPlaneMatrix: mat4.create(),
        getElevation: (_x, _y) => 0,
        tileAnchorPoint: new Point(0, 0),
        transform,
        pitchWithMap: true,
        unwrappedTileID: null,
        width: 1,
        height: 1,
        translation: [0, 0]
    };

    // Only relevant in "behind the camera" case, can't happen with null projection matrix
    const syntheticVertexArgs: ProjectionSyntheticVertexArgs = {
        direction: 1,
        distanceFromAnchor: 0,
        previousVertex: new Point(0, 0),
        absOffsetX: 0
    };

    test('concave', () => {
        /*
                  | |
                  | |
          ________| |
          __________|  <- origin
        */
        projectionContext.projectionCache = {projections: {}, offsets: {}, cachedAnchorPoint: undefined, anyProjectionOccluded: false};
        const lineOffsetY = 1;

        const prevToCurrent = new Point(10, 0);
        const normal = transformToOffsetNormal(prevToCurrent, lineOffsetY, syntheticVertexArgs.direction);
        expect(normal.y).toBeCloseTo(1);
        expect(normal.x).toBeCloseTo(0);
        const intersectionPoint = findOffsetIntersectionPoint(
            1,
            normal,
            new Point(0, 0),
            0,
            3,
            new Point(-10, 1),
            lineOffsetY,
            projectionContext,
            syntheticVertexArgs
        );
        expect(intersectionPoint.y).toBeCloseTo(1);
        expect(intersectionPoint.x).toBeCloseTo(-1);
    });

    test('convex', () => {
        /*
                    | |
                    | |
           origin \ | |
          __________| |
          ____________|
        */
        projectionContext.projectionCache = {projections: {}, offsets: {}, cachedAnchorPoint: undefined, anyProjectionOccluded: false};
        const lineOffsetY = -1;

        const prevToCurrent = new Point(10, 0);
        const normal = transformToOffsetNormal(prevToCurrent, lineOffsetY, syntheticVertexArgs.direction);
        expect(normal.y).toBeCloseTo(-1);
        expect(normal.x).toBeCloseTo(0);
        const intersectionPoint = findOffsetIntersectionPoint(
            1,
            normal,
            new Point(0, 0),
            0,
            3,
            new Point(-10, -1),
            lineOffsetY,
            projectionContext,
            syntheticVertexArgs
        );
        expect(intersectionPoint.y).toBeCloseTo(-1);
        expect(intersectionPoint.x).toBeCloseTo(1);
    });

    test('parallel', () => {
        /*
          ______._____
          ______|_____
        */
        projectionContext.projectionCache = {projections: {}, offsets: {}, cachedAnchorPoint: undefined, anyProjectionOccluded: false};
        const lineOffsetY = 1;

        const prevToCurrent = new Point(10, 0);
        const intersectionPoint = findOffsetIntersectionPoint(
            1,
            transformToOffsetNormal(prevToCurrent, lineOffsetY, syntheticVertexArgs.direction),
            new Point(0, 0),
            3,
            5,
            new Point(-10, 1),
            lineOffsetY,
            projectionContext,
            syntheticVertexArgs
        );
        expect(intersectionPoint.x).toBeCloseTo(0);
        expect(intersectionPoint.y).toBeCloseTo(1);
    });

    test('getPitchedLabelPlaneMatrix: bearing and roll', () => {
        const transform = new MercatorTransform();
        transform.setBearing(0);
        transform.setPitch(45);
        transform.setRoll(45);

        expectToBeCloseToArray([...getPitchedLabelPlaneMatrix(false, transform, 2).values()],
            [0.4330127239227295, -0.4330127239227295, 0, 0, 0.3061862289905548, 0.3061862289905548, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 9);
        expectToBeCloseToArray([...getPitchedLabelPlaneMatrix(true, transform, 2).values()],
            [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 9);
    });

    test('getPitchedLabelPlaneMatrix: bearing and pitch', () => {
        const transform = new MercatorTransform();
        transform.setBearing(45);
        transform.setPitch(45);
        transform.setRoll(0);

        expectToBeCloseToArray([...getPitchedLabelPlaneMatrix(false, transform, 2).values()],
            [0.3535533845424652, -0.3535533845424652, 0, 0, 0.3535533845424652, 0.3535533845424652, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 9);
        expectToBeCloseToArray([...getPitchedLabelPlaneMatrix(true, transform, 2).values()],
            [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 9);
    });

    test('getPitchedLabelPlaneMatrix: bearing, pitch, and roll', () => {
        const transform = new MercatorTransform();
        transform.setBearing(45);
        transform.setPitch(45);
        transform.setRoll(45);

        expectToBeCloseToArray([...getPitchedLabelPlaneMatrix(false, transform, 2).values()],
            [0.08967986702919006,  -0.5226925611495972, 0, 0, 0.5226925611495972, -0.08967986702919006, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 9);
        expectToBeCloseToArray([...getPitchedLabelPlaneMatrix(true, transform, 2).values()],
            [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 9);
    });

    test('getGlCoordMatrix: bearing, pitch, and roll', () => {
        const transform = new MercatorTransform();
        transform.resize(128, 128);
        transform.setBearing(45);
        transform.setPitch(45);
        transform.setRoll(45);

        expectToBeCloseToArray([...getGlCoordMatrix(false, false, transform, 2).values()],
            [...transform.pixelsToClipSpaceMatrix.values()], 9);
        expectToBeCloseToArray([...getGlCoordMatrix(false, true, transform, 2).values()],
            [...transform.pixelsToClipSpaceMatrix.values()], 9);
        expectToBeCloseToArray([...getGlCoordMatrix(true, false, transform, 2).values()],
            [-0.33820396661758423, 1.9711971282958984, 0, 0, -1.9711971282958984, 0.33820396661758423, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 9);
        expectToBeCloseToArray([...getGlCoordMatrix(true, true, transform, 2).values()],
            [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 9);
    });

    test('getTileSkewVectors: bearing', () => {
        const transform = new MercatorTransform();
        transform.setBearing(45);
        transform.setPitch(0);
        transform.setRoll(0);

        expectToBeCloseToArray([...getTileSkewVectors(transform).vecEast.values()],
            [0.7071067690849304, 0.7071067690849304]);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecSouth.values()],
            [-0.7071067690849304, 0.7071067690849304], 9);
    });

    test('getTileSkewVectors: roll', () => {
        const transform = new MercatorTransform();
        transform.setBearing(0);
        transform.setPitch(0);
        transform.setRoll(45);

        expectToBeCloseToArray([...getTileSkewVectors(transform).vecEast.values()],
            [0.7071067690849304, 0.7071067690849304]);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecSouth.values()],
            [-0.7071067690849304, 0.7071067690849304], 9);
    });

    test('getTileSkewVectors: pitch', () => {
        const transform = new MercatorTransform();
        transform.setBearing(0);
        transform.setPitch(45);
        transform.setRoll(0);

        expectToBeCloseToArray([...getTileSkewVectors(transform).vecEast.values()],
            [1.0, 0.0]);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecSouth.values()],
            [0.0, 1.0], 9);
    });

    test('getTileSkewVectors: roll pitch bearing', () => {
        const transform = new MercatorTransform();
        transform.setBearing(45);
        transform.setPitch(45);
        transform.setRoll(45);

        expectToBeCloseToArray([...getTileSkewVectors(transform).vecEast.values()],
            [-0.16910198330879211, 0.9855985641479492]);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecSouth.values()],
            [-0.9855985641479492, 0.16910198330879211], 9);
    });

    test('getTileSkewVectors: pitch 90 degrees', () => {
        const transform = new MercatorTransform();
        transform.setMaxPitch(180);
        transform.setBearing(0);
        transform.setPitch(89);
        transform.setRoll(0);

        expectToBeCloseToArray([...getTileSkewVectors(transform).vecEast.values()],
            [1, 0]);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecSouth.values()],
            [0, 1], 9);

        transform.setPitch(90);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecEast.values()],
            [0, 0]);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecSouth.values()],
            [0, 1], 9);

        transform.setBearing(90);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecEast.values()],
            [0, 0]);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecSouth.values()],
            [-1, 0], 9);
    });

    test('getTileSkewVectors: pitch 90 degrees with roll and bearing', () => {
        const transform = new MercatorTransform();
        transform.setMaxPitch(180);
        transform.setBearing(45);
        transform.setPitch(89);
        transform.setRoll(45);

        expectToBeCloseToArray([...getTileSkewVectors(transform).vecEast.values()],
            [-0.6946603059768677, 0.7193379402160645]);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecSouth.values()],
            [-0.7193379402160645, 0.6946603059768677], 9);

        transform.setPitch(90);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecEast.values()],
            [-0.7071067690849304, 0.7071067690849304]);
        expectToBeCloseToArray([...getTileSkewVectors(transform).vecSouth.values()],
            [-0.7071067690849304, 0.7071067690849304], 9);
    });

});

vi.mock('./painter');
vi.mock('./program');
vi.mock('../source/source_cache');
vi.mock('../source/tile');
vi.mock('../data/bucket/symbol_bucket', () => {
    return {
        SymbolBucket: vi.fn()
    };
});

describe('i dont know', () => {
    test('placeGlyphAlongLine', () => {
        const lineVertexArray = new SymbolLineVertexArray();
        // A three point line along x axis, to origin, and then up y axis
        lineVertexArray.emplaceBack(-10, 0, -10);
        lineVertexArray.emplaceBack(0, 0, 0);
        lineVertexArray.emplaceBack(0, 10, 10);

        // A three point line along the x axis
        lineVertexArray.emplaceBack(-10, 0, -10);
        lineVertexArray.emplaceBack(0, 0, 0);
        lineVertexArray.emplaceBack(10, 0, 10);
        const transform = new MercatorTransform();

        const projectionContext: SymbolProjectionContext = {
            projectionCache: {projections: {}, offsets: {}, cachedAnchorPoint: undefined, anyProjectionOccluded: false},
            lineVertexArray,
            pitchedLabelPlaneMatrix: mat4.create(),
            getElevation: (_x, _y) => 0,
            tileAnchorPoint: new Point(0, 0),
            transform,
            pitchWithMap: true,
            unwrappedTileID: null,
            width: 1,
            height: 1,
            translation: [0, 0]
        };
        const r = placeGlyphAlongLine(20, 0, 0, false, 0, 0, 0, projectionContext, true)
        console.log(r)
    });
    return;
    test('something', () => {

        const createMockTransform = () => {
            return {
                pitch: 0,
                labelPlaneMatrix: mat4.create(),
                getCircleRadiusCorrection: () => 1,
                angle: 0,
                zoom: 0,
                getProjectionData(_canonical, fallback): ProjectionData {
                    return {
                        mainMatrix: fallback,
                        tileMercatorCoords: [0, 0, 1, 1],
                        clippingPlane: [0, 0, 0, 0],
                        projectionTransition: 0.0,
                        fallbackMatrix: fallback,
                    };
                },
            } as any as IReadonlyTransform;
        }

        const painterMock = new Painter(null, null);
        painterMock.context = {
            gl: {},
            activeTexture: {
                set: () => { }
            }
        } as any;
        painterMock.renderPass = 'translucent';
        painterMock.transform = createMockTransform();
        painterMock.options = {} as any;

        const layerSpec = {
            id: 'mock-layer',
            source: 'empty-source',
            type: 'symbol',
            layout: {
                'text-rotation-alignment': 'viewport-glyph',
                'text-field': 'ABC',
                'symbol-placement': 'line',
            },
            paint: {
                'text-opacity': 1
            }
        } as SymbolLayerSpecification;
        const layer = new SymbolStyleLayer(layerSpec);
        layer.recalculate({zoom: 0, zoomHistory: {} as ZoomHistory} as EvaluationParameters, []);

        const tileId = new OverscaledTileID(1, 0, 1, 0, 0);
        tileId.terrainRttPosMatrix32f = mat4.create();
        const programMock = new Program(null, null, null, null, null, null, null, null);
        (painterMock.useProgram as Mock).mockReturnValue(programMock);
        const bucketMock = new SymbolBucket(null);
        bucketMock.icon = {
            programConfigurations: {
                get: () => { }
            },
            segments: {
                get: () => [1]
            },
            hasVisibleVertices: true
        } as any;
        bucketMock.iconSizeData = {
            kind: 'constant',
            layoutSize: 1
        };
        const tile = new Tile(tileId, 256);
        tile.tileID = tileId;
        tile.imageAtlasTexture = {
            bind: () => { }
        } as any;
        (tile.getBucket as Mock).mockReturnValue(bucketMock);
        const sourceCacheMock = new SourceCache(null, null, null);
        (sourceCacheMock.getTile as Mock).mockReturnValue(tile);
        sourceCacheMock.map = {showCollisionBoxes: false} as any as Map;
        painterMock.style = {
            map: {},
            projection: new MercatorProjection()
        } as any as Style;

        const renderOptions: RenderOptions = {isRenderingToTexture: false, isRenderingGlobe: false};
        const s = pixelsToTileUnits(tile, 1, painterMock.transform.zoom);

        const pitchedLabelPlaneMatrix = getPitchedLabelPlaneMatrix(true, painterMock.transform, s);
        const pitchedLabelPlaneMatrixInverse = mat4.create();
        mat4.invert(pitchedLabelPlaneMatrixInverse, pitchedLabelPlaneMatrix);
        const translate: [number, number] = [0, 0]
        const translateAnchor = 'map'
        const translation = translatePosition(painterMock.transform, tile, translate, translateAnchor);

        updateLineLabels(bucketMock, painterMock, true, pitchedLabelPlaneMatrix, pitchedLabelPlaneMatrixInverse, false, false, true, tileId.toUnwrapped(), painterMock.transform.width, painterMock.transform.height, translate, (x: number, y: number) => 0)
        // updateLineLabels(bucket, painter, isText, pitchedLabelPlaneMatrix, pitchedLabelPlaneMatrixInverse, pitchWithMap, keepUpright, rotateToLine, coord.toUnwrapped(), transform.width, transform.height, translation, getElevation);

    })
})