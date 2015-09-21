import _ from 'lodash';
import React from 'react';
import Autocomplete from './autocomplete';
import DecorationToggle from './decoration_toggle';

// TODO: Make sure we only update the view when the model changes.
export default React.createClass({
    getInitialState() {
        return {
            suggestions: [],
            selectedAutocompleteIndex: 0,
            latestKeyCode: null,
            caretPosition: 0,
            caretOffset: 0
        }
    },
    getInputNode() {
        // TODO: Try to cache.
        return this.refs.command.getDOMNode()
    },
    componentWillMount() {
        var keysDownStream = createEventHandler();
        var [passThroughKeys, promptKeys] = keysDownStream.partition(_ => this.props.status === 'in-progress');

        passThroughKeys
            .filter(_.negate(isMetaKey))
            .map(stopBubblingUp)
            .forEach(event => this.props.invocation.write(event));

        var meaningfulKeysDownStream = promptKeys.filter(isDefinedKey).map(stopBubblingUp);
        var [navigateAutocompleteStream, navigateHistoryStream] = meaningfulKeysDownStream
            .filter(event => keys.goDown(event) || keys.goUp(event))
            .partition(this.autocompleteIsShown);

        keysDownStream.filter(_.negate(isCommandKey))
            .forEach(event => this.setState({latestKeyCode: event.keyCode}));

        promptKeys.filter(keys.enter).forEach(this.execute);

        meaningfulKeysDownStream.filter(this.autocompleteIsShown)
            .filter(keys.tab)
            .forEach(this.selectAutocomplete);

        meaningfulKeysDownStream.filter(keys.deleteWord).forEach(this.deleteWord);

        meaningfulKeysDownStream.filter(keys.leftArrow).forEach(this.moveLeft);

        navigateHistoryStream.forEach(this.navigateHistory);
        navigateAutocompleteStream.forEach(this.navigateAutocomplete);

        this.handlers = {
            onKeyDown: keysDownStream
        };
    },
    componentDidMount() {
        $(this.getDOMNode()).fixedsticky();
        $('.fixedsticky-dummy').remove();

        this.getInputNode().focus();
    },
    componentDidUpdate(prevProps, prevState) {
        var inputNode = this.getInputNode();
        inputNode.innerText = this.getText();

        if (prevState.caretPosition !== this.state.caretPosition || prevState.caretOffset !== this.state.caretOffset) {
            setCaretPosition(inputNode, this.state.caretPosition);
        }

        if (prevState.caretPosition !== this.state.caretPosition) {
            this.setState({caretOffset: $(inputNode).caret('offset')});
        }

        scrollToBottom();
    },
    execute() {
        if (!this.isEmpty()) {
            // Timeout prevents two-line input on cd.
            setTimeout(() => this.props.prompt.execute(), 0);
        }
    },
    getText() {
        return this.props.prompt.buffer.toString();
    },
    setText(text) {
        this.props.invocation.setPromptText(text);
        this.setState({caretPosition: this.props.prompt.buffer.cursor.column()});
    },
    moveLeft(event) {
        this.props.prompt.buffer.cursor.moveRelative({horizontal: -1});
        var win = window;
        if(win.getSelection){
            console.log('window exists');
            var sel = win.getSelection();

            if(sel.rangeCount > 0) {
                var textNode = sel.focusNode;
                var offset = sel.focusOffset - 1;
                sel.collapse(textNode, Math.min(textNode.length, offset));
            }
        }
        this.props.prompt.buffer.cursor.setBlink(true);
    },
    isEmpty() {
        return this.getText().replace(/\s/g, '').length === 0;
    },
    navigateHistory(event) {
        if (keys.goUp(event)) {
            var prevCommand = this.props.prompt.history.getPrevious();

            if (typeof prevCommand !== 'undefined') {
                this.setText(prevCommand);
            }
        } else {
            this.setText(this.props.prompt.history.getNext() || '');
        }
    },
    navigateAutocomplete(event) {
        if (keys.goUp(event)) {
            var index = Math.max(0, this.state.selectedAutocompleteIndex - 1)
        } else {
            index = Math.min(this.state.suggestions.length - 1, this.state.selectedAutocompleteIndex + 1)
        }

        this.setState({selectedAutocompleteIndex: index});
    },
    selectAutocomplete() {
        var state = this.state;
        const suggestion = state.suggestions[state.selectedAutocompleteIndex];
        this.props.prompt.replaceCurrentLexeme(suggestion);

        if (!suggestion.partial) {
            this.props.prompt.buffer.write(' ');
        }

        this.props.prompt.getSuggestions().then(suggestions => {
                this.setState({
                    suggestions: suggestions,
                    selectedAutocompleteIndex: 0,
                    caretPosition: this.props.prompt.buffer.cursor.column()
                })
            }
        );
    },
    deleteWord() {
        // TODO: Remove the word under the caret instead of the last one.
        var newCommand = this.props.prompt.getWholeCommand().slice(0, -1).join(' ');

        if (newCommand.length) {
            newCommand += ' ';
        }

        this.setText(newCommand);
    },
    handleInput(event) {
        this.setText(event.target.innerText);

        //TODO: make it a stream.
        this.props.prompt.getSuggestions().then(suggestions =>
            this.setState({
                suggestions: suggestions,
                selectedAutocompleteIndex: 0,
                caretPosition: this.props.prompt.buffer.cursor.column()
            })
        );
    },
    handleScrollToTop(event) {
        stopBubblingUp(event);

        const offset = $(this.props.invocationView.getDOMNode()).offset().top - 10;
        $('html, body').animate({ scrollTop: offset }, 300);
    },
    handleKeyPress(event) {
        if (this.props.status === 'in-progress') {
            stopBubblingUp(event);
        }
    },
    showAutocomplete() {
        //TODO: use streams.
        return this.refs.command &&
            this.state.suggestions.length &&
            this.props.status === 'not-started' && !_.contains([13, 27], this.state.latestKeyCode);
    },
    autocompleteIsShown() {
        return this.refs.autocomplete;
    },
    render() {
        var classes = ['prompt-wrapper', 'fixedsticky', this.props.status].join(' ');

        if (this.showAutocomplete()) {
            var autocomplete = <Autocomplete suggestions={this.state.suggestions}
                                             caretOffset={this.state.caretOffset}
                                             selectedIndex={this.state.selectedAutocompleteIndex}
                                             ref="autocomplete"/>;
        }


        if (this.props.invocationView.state.canBeDecorated) {
            var decorationToggle = <DecorationToggle invocation={this.props.invocationView}/>;
        }

        if (this.props.invocation.hasOutput()) {
            var scrollToTop = <a href="#" className="scroll-to-top" onClick={this.handleScrollToTop}>
                <i className="fa fa-long-arrow-up"></i>
            </a>;
        }

        return (
            <div className={classes}>
                <div className="prompt-decoration">
                    <div className="arrow"/>
                </div>
                <div className="prompt"
                     onKeyDown={this.handlers.onKeyDown}
                     onInput={this.handleInput}
                     onKeyPress={this.handleKeyPress}
                     type="text"
                     ref="command"
                     contentEditable="true"/>
                {autocomplete}
                <div className="actions">
                    {decorationToggle}
                    {scrollToTop}
                </div>
            </div>
        )
    }
});
