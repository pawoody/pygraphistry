'use strict';

var debug   = require('debug')('graphistry:StreamGL:graphVizApp:TimeExplorer');
var $       = window.$;
var Rx      = require('rxjs/Rx.KitchenSink');
              require('../../rx-jquery-stub');
var _       = require('underscore');
var Handlebars = require('handlebars');
var Backbone = require('backbone');
    Backbone.$ = $;

var d3 = require('d3');
var Command = require('../command.js');
var util    = require('../util.js');
var FilterControl = require('../FilterControl.js');
var Identifier = require('../Identifier');
var contentFormatter = require('../contentFormatter.js');




var ZOOM_UPDATE_RATE = 90;
var ZOOM_POLL_RATE = ZOOM_UPDATE_RATE - 10;

function setupSvg (el, margin, width, height) {
    return d3.select(el).append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
        .append('g')
            .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
}


function setupBinScale (width, numBins, data) {

    // console.log('DATA: ', data);
    // Because we know that the first and last bins may be cutoff, we use a linear scale
    // across a longer range that we have, and wrap it to cut off the first bit

    var extra = (1 - data.widths[0]) + (1 - data.widths[data.widths.length - 1]);

    // Different calc for 1 bin, since we'd end up double counting the 'extra' for that.
    if (numBins === 1) {
        extra = extra / 2;
    }

    var ratio = (numBins / (numBins - extra));
    var expandedWidth = width * ratio;

    var rawScale = d3.scale.linear()
        // .range([0, width])
        .range([0, expandedWidth])
        .domain([0, numBins]);

    var leftWidthOffset = ((1 - data.widths[0]) / numBins) * expandedWidth;

    var wrappedScale = function () {
        var rawReturn = rawScale.apply(this, arguments);

        var adjusted = Math.max(0, rawReturn - leftWidthOffset); // Shift left
        adjusted = Math.min(width, adjusted); // Make sure within bounds

        return adjusted;
    };

    wrappedScale.invert = function (arg) {
        var adjustedArg = arg + leftWidthOffset;
        return rawScale.invert.call(this, adjustedArg);

        // TODO: Adjust invert to know about offset
        // var rawReturn = rawScale.invert.apply(this, arguments);
        // return rawReturn;
    };

    wrappedScale.rawScale = rawScale;



    return wrappedScale;
    // return rawScale;

}

function setupAmountScale (height, maxBin) {
    return d3.scale.linear()
        .range([0, height])
        .domain([0, maxBin]);
}



module.exports = {
    setupSvg,
    setupBinScale,
    setupAmountScale,
    ZOOM_UPDATE_RATE,
    ZOOM_POLL_RATE
};

