'use strict';

var P = require('bluebird');

/**
 * The (abstract) base class for Controllers.
 * Each controller is a state machine. A state might instantiate a different controller (which also has a state).
 * There is usually a single Controller that everything begins with (the FrontController).
 * If a route is assigned, it simply defines the hierarchy of states it must assign, for
 * example ['page', 'contact', 'map'] would cause the FrontController to enter the state 'page', this state
 * creates a PageController which is assigned the state 'contact', and so on.
 * @param {ClientContext} context
 * @constructor
 */
function Controller(context)
{
        if (this.constructor === Controller)
        {
                throw Error('Controller is abstract');
        }

        Object.defineProperty(this, 'context' , { value: context });

        this.currentState = null;
        this.__child__ = null;
        this.__parent__ = null;
}

module.exports = Controller;
Object.defineProperty(Controller.prototype, 'isController', { value: true });

Object.defineProperty(Controller.prototype, 'child', {
        get: function()
        {
                return this.__child__;
        },
        set: function(value)
        {
                if (value && value.isController !== true)
                {
                        throw Error('value should be a Controller or null');
                }

                if (this.__child__)
                {
                        this.__child__.__parent__ = null;
                }

                this.__child__ = value;

                if (this.__child__)
                {
                        this.__child__.__parent__ = this;
                }
        }
});

Object.defineProperty(Controller.prototype, 'parent', {
        get: function()
        {
                return this.__parent__;
        },
        set: function(value)
        {
                if (value && value.isController !== true)
                {
                        throw Error('value should be a Controller or null');
                }

                if (this.__parent__)
                {
                        this.__parent__.__child__ = null;
                }

                this.__parent__ = value;

                if (this.__parent__)
                {
                        this.__parent__.__child__ = this;
                }
        }
});

/**
 * @example Controller.stateMethodName('enter', 'foo') // 'enterFoo'
 * @example Controller.stateMethodName('enter', {abc: 5, stateName: 'enterFoo', ...} // 'enterFoo'
 * @param {string} prefix
 * @param {string} state
 * @returns {string}
 */
Controller.stateMethodName = function(prefix, state)
{
        if (typeof state === 'object')
        {
                state = state.stateName;
        }

        state = state.toString();

        return prefix + state.charAt(0).toUpperCase() + state.slice(1);
};

Controller.statesEqual = function(stateA, stateB)
{
        if (stateA &&
            stateB &&
            typeof stateA === 'object')
        {
                if (!stateA.isStateEqual || !stateB.isStateEqual)
                {
                        throw Error('If a state is an object, it must implement a isStateEqual(other) method');
                }

                return stateA.isStateEqual(stateB);
        }

        return stateA === stateB;
};


/**
 * Assign a chain of states to this controller and its children.
 * Each controller has 0 or 1 child controllers. When a controller enters a state, it might create a child controller
 * for that state (by setting the child attribute on its controller).
 * That child controller is also assigned a state by this method (the next one in the chain).
 *
 * @example
 * myController.state('pages', 'contact', 'foo'); // myController is set to the state 'pages',
 *                                                // its child controller is set to 'contact', and so on.
 * @param {?string...} state The state chain (vararg or an array), or null to leave the state without setting a new one.
 * @return {!Promise}
 */
Controller.prototype.state = function(state)
{
        var args;

        var childLeave = function()
        {
                if (this.child)
                {
                        return this.child.state([null]);
                }
        }.bind(this);

        var myLeave = function()
        {
                if (this.currentState)
                {
                        try
                        {
                                return this.leave();
                        }
                        finally
                        {
                                this.currentState = null;
                                this.child = null;
                        }
                }
        }.bind(this);

        var myEnter = function()
        {
                if (state)
                {
                        this.currentState = state;
                        return this.enter(state);
                }
        }.bind(this);

        var childEnter = function()
        {
                if (args.length > 1)
                {
                        if (!this.child)
                        {
                                throw Error('Attempting to set child state "'+args[1]+'", but no child controller has been set by the state "' + state + '".');
                        }

                        return this.child.state(Array.prototype.slice.call(args, 1));
                }
                else
                {
                        if (this.child)
                        {
                                throw Error('Attempting to set state "' + state + '", but the state for the child controller is missing');
                        }
                }
        }.bind(this);

        if (arguments.length === 1)
        {
                args =  Array.isArray(state) ? state : [state];
                state = args[0];
        }
        else
        {
                args = arguments;
        }

        if (Controller.statesEqual(this.currentState, state))
        {
                return P.resolve().then(childEnter);
        }
        else
        {
                return P.resolve().then(childLeave).then(myLeave).then(myEnter).then(childEnter);
        }
};

/**
 * This method is invoked by .state(...) when the state for this controller should change (leave() is called first).
 * The default implementation translates the state to a method invocation.
 * e.g. "foo" -> this.enterFoo()
 * Override this method if you want to do something else (like pulling the states
 * out of a database);
 * @param {string|object} state string or an object that describes your state. toString() is called on the object to
 *        determine the method name to use. {abc: 5, toString: function(){ return 'foo';}, ...} -> this.enterFoo()
 * @throws {Error} If the state method does not exist.
 * @return {?Promise}
 * @protected Use .state() to set the state
 */
Controller.prototype.enter = function(state)
{
        var method;
        this.currentState = state;

        method = Controller.stateMethodName('enter', state);
        if (typeof this[method] !== 'function')
        {
                throw Error('State method ' + method + ' does not exist');
        }

        return this[method](state);
};

/**
 * This method is invoked by .state(...) when the current state is being left.
 * The default implementation translates the state to a method invocation.
 * e.g. "foo" -> this.leaveFoo();
 * Unlike enter(), this method does not throw if this method does not exist.
 * @protected Use .state(null) to leave the state
 * @return {?Promise}
 */
Controller.prototype.leave = function()
{
        var method;

        method = Controller.stateMethodName('leave', this.currentState);

        if (typeof this[method] !== 'function')
        {
                return;
        }

        this[method]();
};

/**
 * Find the top most Controller by iterating over .parent and return it
 * @returns {Controller}
 */
Controller.prototype.getRootController = function()
{
        var cont = this;
        while (cont.parent)
        {
                cont = cont.parent;
        }

        return cont;
};

/**
 * Return the states of this controller and all its children (in that order)
 * @returns {Array}
 */
Controller.prototype.getChildrenStateList = function()
{
        var states = [];
        var cont = this;

        while (cont)
        {
                states.push(cont.currentState);
                cont = cont.child;
        }

        return states;
};

/**
 * Return the states of all the parents of this controller and the controller itself (in that order)
 * @returns {Array}
 */
Controller.prototype.getParentsStateList = function()
{
        var states = [];
        var cont = this;

        while (cont)
        {
                states.unshift(cont.currentState);
                cont = cont.parent;
        }

        return states;
};