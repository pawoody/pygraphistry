var Kernel = require('../../../kernel.js'),
    Q = require('q'),
    _     = require('underscore'),
    cljs  = require('../../../cl.js'),
    ArgsType = require('../../ArgsType.js');

var log         = require('common/logger.js');
var logger      = log.createLogger('graph-viz:cl:barnesKernels');

var edgeKernelSeqFast = function (clContext) {

    this.argsMapEdges = [
        'scalingRatio', 'gravity', 'edgeInfluence', 'flags', 'isForward', 'edges', 'numEdges',
        'pointDegrees', 'inputPoints', 'edgeWeights', 'outputForcesMap'
    ];

    this.argsSegReduce = [
        'scalingRatio', 'gravity', 'edgeInfluence', 'flags', 'numInput', 'input',
        'edgeStartEndIdxs', 'segStart', 'workList', 'numOutput', 'carryOutGlobal', 'output', 'partialForces'
    ];


    this.mapEdges = new Kernel('faEdgeMap', this.argsMapEdges, ArgsType, 'layouts/gpu/forceAtlas2/faEdgeMap.cl', clContext);

    this.segReduce = new Kernel("segReduce", this.argsSegReduce,
                                ArgsType, 'segReduce.cl', clContext);


    this.kernels = [this.mapEdges, this.segReduce];

    this.setPhysics = function(flag) {
        this.mapEdges.set({flags: flag});
        this.segReduce.set({flags: flag});
    };

    this.tempBuffers = {
      outputEdgeForcesMap: null,
      globalCarryOut: null,
      forwardsEdgeStartEndIdxs: null,
      backwardsEdgeStartEndIdxs: null,
      segStart: null
    }

    this.setEdges = function(simulator, layoutBuffers) {

      var forwardsEdges = simulator.dataframe.getHostBuffer('forwardsEdges');
      var backwardsEdges = simulator.dataframe.getHostBuffer('backwardsEdges');
      var numEdges = simulator.dataframe.getNumElements('edge');
      var numPoints = simulator.dataframe.getNumElements('point');

      var that = this;
        return Q.all([
            simulator.cl.createBuffer(forwardsEdges.edgesTyped.byteLength, 'outputEdgeForcesMap'),
            simulator.cl.createBuffer(1 + Math.ceil(numEdges / 256), 'globalCarryIn'),
            simulator.cl.createBuffer(forwardsEdges.edgeStartEndIdxsTyped.byteLength, 'forwardsEdgeStartEndIdxs'),
            simulator.cl.createBuffer(backwardsEdges.edgeStartEndIdxsTyped.byteLength, 'backwardsEdgeStartEndIdxs'),
            simulator.cl.createBuffer((numPoints * Float32Array.BYTES_PER_ELEMENT) / 2, 'segStart')])
    .spread(function(outputEdgeForcesMap, globalCarryOut, forwardsEdgeStartEndIdxs, backwardsEdgeStartEndIdxs,
                     segStart) {
        // Bind buffers
        that.tempBuffers.outputEdgeForcesMap = outputEdgeForcesMap;
        that.tempBuffers.globalCarryOut = globalCarryOut;
        that.tempBuffers.forwardsEdgeStartEndIdxs = forwardsEdgeStartEndIdxs;
        that.tempBuffers.backwardsEdgeStartEndIdxs = backwardsEdgeStartEndIdxs;
        that.tempBuffers.segStart = segStart;
        return Q.all([
            that.tempBuffers.forwardsEdgeStartEndIdxs.write(forwardsEdges.edgeStartEndIdxsTyped),
            that.tempBuffers.backwardsEdgeStartEndIdxs.write(backwardsEdges.edgeStartEndIdxsTyped)
        ]);
    })
    };

    this.execKernels = function(simulator, forwardsEdges, forwardsWorkItems,
                                backwardsEdges, backwardsWorkItems, points,
                                pointDegrees, workItemsSize) {
      var that = this;
      return this.edgeForcesOneWay(simulator, forwardsEdges, forwardsWorkItems,
                                   points,
                                   pointDegrees,
                                   simulator.dataframe.getBuffer('forwardsEdgeWeights', 'simulator'),
                                   simulator.dataframe.getBuffer('partialForces1', 'simulator'),
                                   simulator.dataframe.getBuffer('partialForces2', 'simulator'),
                                   simulator.dataframe.getBuffer('forwardsEdgeStartEndIdxs', 'simulator'),
                                   workItemsSize,
                                   1)
        .then(function () {
            return that.edgeForcesOneWay(simulator, backwardsEdges, backwardsWorkItems,
                                         points,
                                         pointDegrees,
                                         simulator.dataframe.getBuffer('backwardsEdgeWeights', 'simulator'),
                                         simulator.dataframe.getBuffer('partialForces2', 'simulator'),
                                         simulator.dataframe.getBuffer('curForces', 'simulator'),
                                         simulator.dataframe.getBuffer('backwardsEdgeStartEndIdxs', 'simulator'),
                                         workItemsSize,
                                         0);
        });
    }


    this.edgeForcesOneWay = function(simulator, edges, workItems, points, pointDegrees, edgeWeights,
                                     partialForces, outputForces, startEnd, workItemsSize, isForward) {

      var numEdges = simulator.dataframe.getNumElements('edge');
      var numPoints = simulator.dataframe.getNumElements('point');

      this.mapEdges.set({
        numEdges: numEdges,
        edges: edges.buffer,
        pointDegrees: pointDegrees.buffer,
        inputPoints: points.buffer,
        edgeWeights: edgeWeights.buffer,
        outputForcesMap: simulator.dataframe.getBuffer('outputEdgeForcesMap', 'simulator').buffer,
        isForward: isForward
      });

      var resources = [edges, workItems, points, partialForces, outputForces];

      simulator.tickBuffers(
          simulator.dataframe.getBufferKeys('simulator').filter(function (name) {
            return simulator.dataframe.getBuffer(name, 'simulator') == outputForces;
          })
          );

      logger.trace("Running kernel faEdgeForces");
      var that = this;
      return this.mapEdges.exec([workItemsSize.edgeForces[0]], resources, [workItemsSize.edgeForces[1]]).then(function () {
        that.segReduce.set({
          edgeStartEndIdxs: startEnd.buffer,
          input: simulator.dataframe.getBuffer('outputEdgeForcesMap', 'simulator').buffer,
          segStart: simulator.dataframe.getBuffer('segStart', 'simulator').buffer,
          numInput: numEdges,
          numOutput: numPoints,
          workList: workItems.buffer,
          output: outputForces.buffer,
          partialForces:partialForces.buffer,
          carryOutGlobal: simulator.dataframe.getBuffer('globalCarryOut', 'simulator').buffer
        })

        return that.segReduce.exec([workItemsSize.segReduce[0]], resources, [workItemsSize.segReduce[1]]);
      })
      .fail(log.makeQErrorHandler(logger, "Executing edgeKernelSeqFast failed"));

    }
}

module.exports = edgeKernelSeqFast;
