'use strict';

var _ = require('underscore');
var dateFormat = require('dateformat');


var Dataframe = function () {
    // We keep a copy of the original data, plus a filtered view
    // that defaults to the new raw data.
    //
    // This is to allow tools like filters/selections to propogate to
    // all other tools that rely on data frames.

    this.rawdata = {
        attributes: {
            point: {},
            edge: {}
        },
        buffers: {}
    };
    this.data = this.rawdata;
};


//////////////////////////////////////////////////////////////////////////////
// Data Loading
//////////////////////////////////////////////////////////////////////////////

// Type can be 'point' or 'edge'
// TODO: Implicit degrees for points and src/dst for edges.
Dataframe.prototype.load = function (attributes, type) {
    decodeStrings(attributes);
    decodeDates(attributes);

    var nodeTitleField = getNodeTitleField(attributes);
    var edgeTitleField = getEdgeTitleField(attributes);

    var filteredKeys = _.keys(attributes)
        .filter(function (name) {
            return ['pointColor', 'pointSize', 'pointTitle', 'pointLabel',
                    'edgeLabel', 'edgeTitle', 'degree'].indexOf(name) === -1;
        })
        .filter(function (name) { return name !== nodeTitleField && name !== edgeTitleField; })

    var filteredAttributes = _.pick(attributes, function (value, key) {
        return filteredKeys.indexOf(key) > -1;
    });

    var numElements = filteredAttributes[filteredKeys[0]].values.length;

    if (nodeTitleField) {
        filteredAttributes._title = attributes[nodeTitleField];
    } else if (edgeTitleField) {
        filteredAttributes._title = attributes[edgeTitleField];
    } else {
        filteredAttributes._title = {type: 'number', values: range(numElements)};
    }

    _.extend(this.rawdata.attributes[type], filteredAttributes);
    // TODO: Case where data != raw data.
}



//////////////////////////////////////////////////////////////////////////////
// Data Access
//////////////////////////////////////////////////////////////////////////////


// Returns array of row (fat json) objects
Dataframe.prototype.getRows = function (indices, type) {
    var attributes = this.data.attributes[type];

    return _.map(indices, function (index) {
        var row = {};
        _.each(_.keys(attributes), function (key) {
            row[key] = attributes[key].values[index];
        });
        return row;
    });
}


Dataframe.prototype.getColumn = function (column, type) {
    var attributes = this.data.attributes[type];
    return attributes[column].values;
}


Dataframe.prototype.getAttributeKeys = function (type) {
    return _.sortBy(
        _.keys(this.data.attributes[type]),
        _.identity
    );
}



//////////////////////////////////////////////////////////////////////////////
// Aggregations and Histograms
//////////////////////////////////////////////////////////////////////////////


Dataframe.prototype.aggregate = function (indices, attributes, binning, mode, type) {
    var that = this;

    function process(attribute, indices) {

        var goalNumberOfBins = binning ? binning._goalNumberOfBins : 0;
        var binningHint = binning ? binning[attribute] : undefined;
        var dataType = that.data.attributes[type][attribute].type;

        if (mode !== 'countBy' && dataType !== 'string') {
            return that.histogram(attribute, binningHint, goalNumberOfBins, indices, type);
        } else {
            return that.countBy(attribute, binningHint, indices, type);
        }
    }

    var keysToAggregate = attributes ? attributes : this.getAttributeKeys(type);
    keysToAggregate = keysToAggregate.filter(function (val) {
        return val[0] !== '_';
    });

    return _.object(_.map(keysToAggregate, function (attribute) {
        return [attribute, process(attribute, indices)];
    }));
}


Dataframe.prototype.countBy = function (attribute, binning, indices, type) {
    var values = this.data.attributes[type][attribute].values;


    // TODO: Get this value from a proper source, instead of hard coding.
    var maxNumBins = 29;

    if (indices.length === 0) {
        return {type: 'nodata'};
    }

    var rawBins = _.countBy(indices, function (valIdx) {
        return values[valIdx];
    });

    var numBins = Math.min(_.keys(rawBins).length, maxNumBins);
    var numBinsWithoutOther = numBins - 1;
    var sortedKeys = _.sortBy(_.keys(rawBins), function (key) {
        return -1 * rawBins[key];
    });

    // Copy over numBinsWithoutOther from rawBins to bins directly.
    // Take the rest and bucket them into '_other'
    var bins = {};
    _.each(sortedKeys.slice(0, numBinsWithoutOther), function (key) {
        bins[key] = rawBins[key]
    });

    var otherKeys = sortedKeys.slice(numBinsWithoutOther);
    if (otherKeys.length === 1) {
        bins[otherKeys[0]] = rawBins[otherKeys[0]];
    } else if (otherKeys.length > 1) {
        var sum = _.reduce(otherKeys, function (memo, key) {
            return memo + rawBins[key];
        }, 0);
        bins._other = sum;
    }

    var numValues = _.reduce(_.values(bins), function (memo, num) {
        return memo + num;
    }, 0);

    return {
        type: 'countBy',
        numValues: numValues,
        numBins: _.keys(bins).length,
        bins: bins,
    };
}

Dataframe.prototype.histogram = function (attribute, binning, goalNumberOfBins, indices, type) {
    // Binning has binWidth, minValue, maxValue, and numBins

    // Disabled because filtering is expensive, and we now have type safety coming from
    // VGraph types.
    // values = _.filter(values, function (x) { return !isNaN(x)});

    var values = this.data.attributes[type][attribute].values;

    var numValues = indices.length;
    if (numValues === 0) {
        return {type: 'nodata'};
    }

    var goalBins = numValues > 30 ? Math.ceil(Math.log(numValues) / Math.log(2)) + 1
                                 : Math.ceil(Math.sqrt(numValues));

    goalBins = Math.min(goalBins, 30); // Cap number of bins.
    goalBins = Math.max(goalBins, 8); // Cap min number of bins.


    // Override if provided binning data.
    if (binning) {
        var numBins = binning.numBins;
        var binWidth = binning.binWidth;
        var bottomVal = binning.minValue;
        var topval = binning.maxValue;
        var min = binning.minValue;
        var max = binning.maxValue;

    } else {

        var minMax = minMaxMasked(values, indices);
        var max = minMax.max;
        var min = minMax.min;

        if (goalNumberOfBins) {
            var numBins = goalNumberOfBins;
            var bottomVal = min;
            var topVal = max;
            var binWidth = (max - min) / numBins;

        // Try to find a good division.
        } else {
            var goalWidth = (max - min) / goalBins;

            var binWidth = 10;
            var numBins = (max - min) / binWidth;
            // Get to a rough approx
            while (numBins < 2 || numBins >= 100) {
                if (numBins < 2) {
                    binWidth *= 0.1;
                } else {
                    binWidth *= 10;
                }
                numBins = (max - min) / binWidth;
            }
            // Refine by doubling/halving
            var minBins = Math.max(4, Math.floor(goalBins / 2) - 1);
            while (numBins < minBins || numBins > goalBins) {
                if (numBins < minBins) {
                    binWidth /= 2;
                } else {
                    binWidth *= 2;
                }
                numBins = (max - min) / binWidth;
            }

            var bottomVal = round_down(min, binWidth);
            var topVal = round_up(max, binWidth);
            numBins = Math.round((topVal - bottomVal) / binWidth);
        }
    }

    // Guard against 0 width case
    if (max === min) {
        binWidth = 1;
        numBins = 1;
        topVal = min + 1;
        bottomVal = min;
    }

    var bins = Array.apply(null, new Array(numBins)).map(function () { return 0; });

    var binId;
    for (var i = 0; i < indices.length; i++) {
        // Here we use an optimized "Floor" because we know it's a smallish, positive number.
        binId = ((values[indices[i]] - bottomVal) / binWidth) | 0;
        bins[binId]++;
    }

    return {
        type: 'histogram',
        numBins: numBins,
        binWidth: binWidth,
        numValues: numValues,
        maxValue: topVal,
        minValue: bottomVal,
        bins: bins
    };
}



//////////////////////////////////////////////////////////////////////////////
// Helper Functions
//////////////////////////////////////////////////////////////////////////////


function decodeStrings (attributes) {
    _.each(_.keys(attributes), function (key) {
        var decoded = _.map(attributes[key].values, function (val) {
            try {
                return (typeof val === 'string') ? decodeURIComponent(val) : val;
            } catch (e) {
                console.error('bad read val', val);
                return val;
            }
        });
        attributes[key].values = decoded;
    });
}

function decodeDates (attributes) {
    _.each(_.keys(attributes), function (key) {
        var decoded = _.map(attributes[key].values, function (val) {
            return key.indexOf('Date') > -1 && typeof(val) === "number" ?
                    dateFormat(val, 'mm-dd-yyyy') : val;
        });
        attributes[key].values = decoded;
    });
}


function pickTitleField (attribs, prioritized) {
    for (var i = 0; i < prioritized.length; i++) {
        var field = prioritized[i];
        if (attribs.hasOwnProperty(field)) {
            return field;
        }
    }
    return undefined;
}


function getNodeTitleField (attribs) {
    var prioritized = ['pointTitle', 'node', 'label', 'ip'];
    return pickTitleField(attribs, prioritized);
}


function getEdgeTitleField (attribs) {
    var prioritized = ['edgeTitle', 'edge'];
    return pickTitleField(attribs, prioritized);
}

function range (n) {
    var arr = [];
    for (var i = 0; i < n; i++) {
        arr.push(i);
    }
    return arr;
}


function round_down(num, multiple) {
    if (multiple == 0) {
        return num;
    }

    var div = num / multiple;
    return multiple * Math.floor(div);
}

function round_up(num, multiple) {
    if (multiple == 0) {
        return num;
    }

    var div = num / multiple;
    return multiple * Math.ceil(div);
}

function minMaxMasked(values, indices) {
    var min = Infinity;
    var max = -Infinity;

    _.each(indices, function (valueIdx) {
        var val = values[valueIdx];
        if (val < min) {
            min = val;
        }
        if (val > max) {
            max = val;
        }
    });
    return {max: max, min: min};
}


module.exports = Dataframe;
