Modules.VERSION = '1.1.1';

this.grids = {
	allHits: new Set(),
	hoverHits: new Set(),
	currentHits: new Set(),
	frames: new Set(),
	pdfPageRows: new Map(),
	_nextHit: 0,
	
	chromeGrid: {
		_lastUsedRow: 0,
		rows: [],
		
		setAttribute: function(attr, val) {
			message('Grid:Attribute', { attr: attr, val: val });
		},
		
		removeAttribute: function(attr) {
			message('Grid:Attribute', { attr: attr, remove: true });
		},
		
		style: function(prop, val) {
			message('Grid:Style', { prop: prop, val: val });
		},
		
		direction: function(dir) {
			message('Grid:Direction', dir);
		}
	},
	
	handleEvent: function(e) {
		switch(e.type) {
			case 'resize':
				Timers.init('resizeGridSpacers', () => { this.resizeSpacers(); });
				break;
			
			case 'scroll':
				Timers.init('delayUpdatePDFGrid', () => { this.updatePDFGrid(); }, 50);
				break;
		}
	},
	
	onCleanUpHighlights: function() {
		this.clean();
	},
	
	onWillHighlight: function() {
		this.reset();
	},
	
	onHighlightFinished: function(aHighlight) {
		if(aHighlight) {
			this.fill();
		}
	},
	
	onFindAgain: function() {
		this.followCurrent();
	},

	onPDFMatches: function(newMatches) {
		if(!newMatches) {
			var matches = this.allHits.size;
			for(let page of this.pdfPageRows.values()) {
				matches += page.matches;
			}
			
			if(matches == Finder.matchesPDF) {
				if(matches > 0 && !PDFJS.findController.state.highlightAll) {
					this.reset();
					return;
				}
				
				this.followCurrent();
				return;
			}
		}
		
		this.reset();
		if(PDFJS.findController.state.highlightAll) {
			this.fill();
		}
	},
	
	get: function(frame) {
		// The main document is highlighted in chrome, outside of the document itself.
		if(frame == content) {
			this.adjustGridRows(this.chromeGrid);
			return this.chromeGrid;
		}
		
		var owner = frame.parent && frame.parent.document;
		var boxNode = null;
		var grid = null;
		var sameOwner = null;
		
		for(let frameGrid of this.frames) {
			if(!this.testFrameGrid(frameGrid)) { continue; }
			
			// for safety, since afterwards we assume as much
			if(frameGrid._container.childNodes.length != Prefs.gridLimit) {
				frameGrid.remove();
				this.frames.delete(frameGrid);
				continue;
			}
			
			// if we already have a grid for this frame, use it
			if(frameGrid.linkedFrame == frame) {
				return frameGrid;
			}
			
			if(!sameOwner && frameGrid.ownerDocument == owner) {
				sameOwner = frameGrid.parentNode;
			}
		}
		
		// If we don't have a grid, first we try to clone an already existing grid present in this document, it's faster this way
		if(sameOwner) {
			boxNode = sameOwner.cloneNode(true);
			grid = boxNode.firstChild;
			grid._container = grid.childNodes[1];
			grid.rows = [];
			
			// the grid's reference rows need to be re-done, since cloning the node doesn't do this automatically of course
			let rows = [];
			for(let row of grid._container.childNodes) {
				rows.push(row);
			}
			
			for(let row of rows) {
				new GridRow(grid, row);
				
				// reset it as well
				this.removeHighlight(row);
			}
		}
		
		// Still no grid for this frame, so we create a new one
		if(!grid) {
			var divFrame = (!document.baseURI.startsWith('chrome://updatescan/'));
			boxNode = this.create(owner, divFrame);
			grid = boxNode.firstChild;
		}
		
		// ok we should be able to safely add it to the document now
		owner.documentElement.appendChild(boxNode);
		
		grid.linkedFrame = frame;
		this.frames.add(grid);
		
		// Initialize it
		grid._lastUsedRow = 0;
		boxNode.style.direction = this.direction(frame.document);
		this.placeGridOnFrame(grid);
		
		// We're ready to add the highlights now
		return grid;
	},
	
	// Creates a new grid
	create: function(doc, html) {
		if(html) {
			var vbox = 'div';
			var hbox = 'div';
		} else {
			var vbox = 'vbox';
			var hbox = 'hbox';
		}
		
		// First the grid itself
		var boxNode = doc.createElement(hbox);
		boxNode.setAttribute('anonid', 'gridBox');
		
		// It shouldn't depend on the stylesheet being loaded, it could error and the browser would be unusable
		boxNode.style.pointerEvents = 'none';
		
		var gridNode = doc.createElement(vbox);
		gridNode.setAttribute('anonid', 'findGrid');
		gridNode = boxNode.appendChild(gridNode);
		
		// Starting with the top spacer
		var topspacer = doc.createElement(vbox);
		topspacer.setAttribute('flex', '0');
		topspacer.setAttribute('class', 'topSpacer');
		topspacer = gridNode.appendChild(topspacer);
		
		// Container for the highlight rows
		gridNode._container = doc.createElement(vbox);
		gridNode._container.setAttribute('flex', '1');
		gridNode.appendChild(gridNode._container);
		
		// Row template, so I can just clone from this
		var row = doc.createElement(vbox);
		row.style.minHeight = '2px';
		
		// all rows go in grid.rows, easier to manage and to mirror in the chrome grid placeholder
		gridNode.rows = [];
		new GridRow(gridNode, row);
		this.adjustGridRows(gridNode);
		
		// append another spacer at the bottom
		var bottomspacer = topspacer.cloneNode(true);
		bottomspacer.setAttribute('class', 'bottomSpacer');
		gridNode.appendChild(bottomspacer);
		
		// We need to ensure specificity
		// and that if the grid remains when the add-on is disabled, it doesn't affect the webpage it is placed into.
		setAttribute(boxNode, 'ownedByFindBarTweak', 'true');
		
		if(html) {
			setAttribute(boxNode, 'hidden', 'true');
			boxNode.style.position = 'absolute';
		} else {
			removeAttribute(boxNode, 'hidden');
			boxNode.style.position = 'fixed';
		}
		
		return boxNode;
	},
	
	adjustGridRows: function(grid) {
		if(grid.rows.length == Prefs.gridLimit) { return; }
		
		while(grid.rows.length < Prefs.gridLimit) {
			// we only clone if we're dealing with actual grids in content, otherwise (chromeGrid) we pass falsey and let the interface messages handle it
			var clone = grid._container && grid._container.firstChild.cloneNode(true);
			new GridRow(grid, clone);
		}
		while(grid.rows.length > Prefs.gridLimit) {
			grid.rows[grid.rows.length -1].remove();
		}
	},
	
	fill: function() {
		// For PDF files
		if(isPDFJS) {
			// don't fill the grid if there are too many highlights or when it's empty; it will be invisible so we don't need to do anything
			if(Finder.matchesPDF == 0 || Finder.matchesPDF > Prefs.gridLimit) { return; }
			
			var pages = PDFJS.findController.pageMatches;
			var grid = this.get(content);
			
			for(let pIdx in pages) {
				if(pages[pIdx].length == 0) { continue; }
				
				// If the page is rendered, place the actual highlights positions
				if(PDFJS.viewerApplication.pdfViewer.pages[pIdx].textLayer
				&& PDFJS.viewerApplication.pdfViewer.pages[pIdx].textLayer.renderingDone
				&& PDFJS.viewerApplication.pdfViewer.pages[pIdx].renderingState == PDFJS.unWrap.RenderingStates.FINISHED) {
					this.fillWithPDFPage(grid, pIdx);
				}
				
				// If the page isn't rendered yet, use a placeholder for the page with a pattern
				else {
					var row = this.placeHighlight(grid, { pIdx: pIdx }, true);
					// we shouldn't need to send this to chrome, the row can take care of itself
					new GridPDFPage(pIdx, row, pages[pIdx].length);
				}
			}
			
			// don't use the Listeners object, so we don't keep references to old nodes in there
			$('viewerContainer').addEventListener('scroll', this);
		}
		
		// For normal HTML pages
		else {
			// The grid is empty, so invisible, we don't need to do anything
			if(Finder._lastFindResult == Ci.nsITypeAheadFind.FIND_NOTFOUND
			|| !Finder.searchString
			|| !Finder._highlights
			// don't fill the grid if there are too many highlights
			|| Finder._highlights.all.length > Prefs.gridLimit) {
				return;
			}
			
			var ao = null;
			var frameset = false;
			
			if(!viewSource) {
				// Special case for GMail
				// We only place the highlights that are from the main "frame", and use this element's relative position and dimensions to position them.
				if(document.baseURI.startsWith('https://mail.google.com/mail/')) {
					ao = $$('div.AO')[0];
					if(ao) {
						let hits = Finder._highlights.wins.get(Finder.getWindow);
						for(let hit of hits) {
							if(!isAncestor(hit.range.startContainer, ao)) {
								hit.skip = true;
							}
						}
					}
				}
				
				// Special case for framesets
				// We don't add the main grid in the documentElement, as that never has content, we only use frame grids in here.
				else if(document.getElementsByTagName('frameset')[0]
				// https://github.com/Quicksaver/FindBar-Tweak/issues/86 - we use the same frameset rationale for Update Scanner's diff page
				|| document.baseURI.startsWith('chrome://updatescan/')) {
					frameset = true;
				}
			}
			
			for(let [win, highlights] of Finder._highlights.wins) {
				// don't bother if the page is a frameset and we're in the root document, it will likely not have anything anyway
				if(win == content && frameset) { continue; }
				
				// also don't bother if we somehow end up on a frame in gmail
				if(win != content && ao) { break; }
				
				let grid = this.get(win);
				let frameRows = [];
				
				if(win == content && ao) {
					grid.linkedAO = ao;
				}
				
				// We're placing a highlight in a frame, so we should also place that frame in its parent's grid
				else if(win != content) {
					try {
						let frameElement = win.frameElement;
						let parent = win.parent;
						while(parent) {
							// but not if we're at the root of a frameset
							if(parent != content || !frameset) {
								frameRows.push(this.placeHighlight(this.get(parent), frameElement, true));
							}
							
							if(parent == content) { break; }
							frameElement = parent.frameElement
							parent = parent.parent;
						}
					}
					catch(ex) { Cu.reportError(ex); }
				}
				
				for(let highlight of highlights) {
					if(highlight.skip) { continue; }
					
					let rowList = frameRows.concat([]);
					
					try {
						// If it's an editable node, add it directly
						rowList.push(this.placeHighlight(grid, highlight.editableNode || highlight.range, highlight.editableNode));
						
						new GridHit((win == content), rowList, highlight);
					}
					catch(ex) { Cu.reportError(ex); }
				}
			}
		}
		
		this.followCurrent();
		this.resizeSpacers();
		Listeners.add(Scope, 'resize', this);
	},
	
	followCurrent: function() {
		this.clearCurrentRows();
		
		// Special routine for PDF.JS
		if(isPDFJS) {
			if(document.readyState != 'complete' && document.readyState != 'interactive') { return; }
			
			// We need this to access protected properties, hidden from privileged code
			var selected = PDFJS.findController.selected;
			if(selected.pageIdx == -1 || selected.matchIdx == -1) { return; }
			
			for(let hit of this.allHits) {
				if(hit.pIdx == selected.pageIdx && hit.mIdx == selected.matchIdx) {
					hit.setCurrent(true);
					return; // no need to process the rest
				}
			}
			
			return;
		}
		
		// Normal HTML
		if(this.allHits.size == 0) { return; }
		
		var sel = Finder.currentTextSelection;
		if(sel.rangeCount == 1) {
			var cRange = sel.getRangeAt(0);
			for(let hit of this.allHits) {
				if(Finder.compareRanges(cRange, hit.range)) {
					hit.setCurrent(true);
					return; // no need to process the rest
				}
			}
		}
	},
	
	hoverHit: function(aHit) {
		if(isPDFJS) {
			// If the hit's page hasn't been rendered yet, we just hover its patterned placeholder
			if(this.pdfPageRows.has(aHit.pIdx)) {
				this.pdfPageRows.get(aHit.pIdx).setHover(true);
				return;
			}
			
			for(let hit of this.allHits) {
				if(aHit.pIdx == hit.pIdx && aHit.mIdx == hit.mIdx) {
					hit.setHover(true);
					return;
				}
			}
			
			return;
		}
		
		// This is actually very direct
		for(let hit of this.allHits) {
			for(let row of hit.rows) {
				if(Finder.compareRanges(aHit, row.highlight.node)) {
					hit.setHover(true);
					return;
				}
			}
		}
	},
	
	updatePDFGrid: function() {
		if(!isPDFJS) { return; }
		
		var updatePages = [];
		for(let [pIdx, page] of this.pdfPageRows) {
			if(PDFJS.viewerApplication.pdfViewer.pages[pIdx].textLayer
			&& PDFJS.viewerApplication.pdfViewer.pages[pIdx].textLayer.renderingDone
			&& PDFJS.viewerApplication.pdfViewer.pages[pIdx].renderingState == PDFJS.unWrap.RenderingStates.FINISHED) {
				updatePages.push(pIdx);
				
				this.removeHighlight(page.row);
				this.pdfPageRows.delete(pIdx);
			}
		}
		
		if(updatePages.length == 0) { return; }
		
		var grid = this.get(content);
		this.clearHoverRows();
		
		var updatedPages = {};
		for(let page of updatePages) {
			if(!updatedPages[page]) {
				this.fillWithPDFPage(grid, page);
				updatedPages[page] = true;
			}
		}
		
		this.followCurrent();
	},
	
	fillWithPDFPage: function(grid, pIdx) {
		var matches = PDFJS.findController.pageMatches[pIdx];
		var textLayer = PDFJS.viewerApplication.pdfViewer.pages[pIdx].textLayer;
		
		// We need to associate the highlighted nodes with the matches, since PDF.JS doesn't actually do that
		for(let mIdx in matches) {
			var rowList = [];
			
			var offset = 0;
			var beginOffset = textLayer.matches[mIdx].begin.offset;
			var endOffset = textLayer.matches[mIdx].end.offset;
			loop_divIdx: for(let divIdx = textLayer.matches[mIdx].begin.divIdx; divIdx <= textLayer.matches[mIdx].end.divIdx; divIdx++) {
				let childIdx = 0;
				while(childIdx < textLayer.textDivs[divIdx].childNodes.length) {
					var curChild = textLayer.textDivs[divIdx].childNodes[childIdx];
					if(curChild.nodeType == 1) {
						if(curChild.classList.contains('highlight') && offset >= beginOffset) {
							rowList.push(this.placeHighlight(grid, {
								pIdx: pIdx,
								divIdx: divIdx,
								childIdx: childIdx
							}, false));
						}
						offset += curChild.textContent.length;
					}
					else {
						offset += curChild.length;
					}
					
					if(offset >= endOffset) { break loop_divIdx; }
					childIdx++;
				}
			}
			
			new GridHit(true, rowList, { pIdx: pIdx, mIdx: mIdx });
		}
	},
	
	getRow: function(grid) {
		while(grid.rows[grid._lastUsedRow].highlight) {
			grid._lastUsedRow++;
			if(grid._lastUsedRow == grid.rows.length) { grid._lastUsedRow = 0; }
		}
		return grid.rows[grid._lastUsedRow];
	},
	
	placeHighlight: function(grid, node, pattern) {
		var row = this.getRow(grid);
		
		// By separating this part of the process, we gain valuable speed when running searches with lots of highlights (no breaks when typing)
		row.highlight = {
			node: node,
			timer: aSync(() => {
				if(!row.highlight || row.highlight.node != node) { return; }
				
				if(grid.linkedAO) {
					var scrollTop = grid.linkedAO.firstChild.scrollTop;
					var scrollHeight = grid.linkedAO.firstChild.scrollHeight;
				} else if(grid.linkedFrame) {
					var scrollTop = getDocProperty(grid.linkedFrame.document, 'scrollTop');
					var scrollHeight = getDocProperty(grid.linkedFrame.document, 'scrollHeight');
				} else {
					var scrollTop = getDocProperty(document, 'scrollTop');
					var scrollHeight = getDocProperty(document, 'scrollHeight');
				}
				
				var placeNode = node;
				if(isPDFJS) {
					if(pattern) {
						placeNode = $('pageContainer'+PDFJS.viewerApplication.pdfViewer.pages[node.pIdx].id);
					} else {
						placeNode = PDFJS.viewerApplication.pdfViewer.pages[node.pIdx].textLayer.textDivs[node.divIdx].childNodes[node.childIdx];
					}
				}
				
				var rect = placeNode.getBoundingClientRect();
				var absTop = rect.top;
				var absBot = rect.bottom;
				
				if(grid.linkedAO) {
					absTop -= grid.linkedAO.offsetTop;
					absBot -= grid.linkedAO.offsetTop;
				}
				
				absTop = (absTop + scrollTop) / scrollHeight;
				absBot = (absBot + scrollTop) / scrollHeight;
				
				// Sometimes, on hidden nodes for example, these would be placed outside the normal boundaries of the grid, which just would make them look weird
				if(!isPDFJS && (absBot < 0 || absTop > 1)) { return; }
				
				setAttribute(row, 'highlight', 'true');
				toggleAttribute(row, 'pattern', pattern);
				row.style('top', (absTop *100)+'%');
				row.style('height', ((absBot -absTop) *100)+'%');
				
				// make sure that if we're in a frame grid that it is visible
				setAttribute(grid.parentNode, 'unHide', 'true');
			}, 250)
		};
		
		return row;
	},
	
	removeHighlight: function(row) {
		removeAttribute(row, 'hover');
		removeAttribute(row, 'current');
		removeAttribute(row, 'pattern');
		removeAttribute(row, 'highlight');
		row.highlight = null;
	},
	
	// Removes all highlights from the grid
	clean: function() {
		this.clearHoverRows();
		this.clearCurrentRows();
		
		for(let page of this.pdfPageRows.values()) {
			removeAttribute(page.row, 'highlight');
			removeAttribute(page.row, 'pattern');
			page.row.highlight = null;
		}
		this.pdfPageRows = new Map();
		
		for(let hit of this.allHits) {
			for(let row of hit.rows) {
				removeAttribute(row, 'highlight');
				removeAttribute(row, 'pattern');
				row.highlight = null;
			}
		}
		this.allHits = new Set();
	},
	
	// Prepares the grid to be filled with the highlights
	reset: function() {
		this.clean();
		
		this.chromeGrid.linkedAO = null;
		this.chromeGrid.style('paddingTop', '');
		this.chromeGrid.direction(this.direction(document));
		removeAttribute(this.chromeGrid, 'gridSpacers');
		Listeners.remove(Scope, 'resize', this);
		
		if(isPDFJS) {
			var offsetY = $$('div.toolbar')[0].clientHeight;
			this.chromeGrid.style('paddingTop', offsetY +'px');
		}
		// Special case for GMail
		else if(document.baseURI.startsWith('https://mail.google.com/mail/')) {
			var offsetY = $$('div.AO')[0].offsetTop;
			this.chromeGrid.style('paddingTop', offsetY +'px');
		}
		else {
			for(let frameGrid of this.frames) {
				// In case the frame element doesn't exist anymore for some reason, we remove it from the array.
				if(!this.testFrameGrid(frameGrid)) { continue; }
				
				frameGrid.parentNode.style.direction = this.direction(frameGrid.linkedFrame.document);
				this.placeGridOnFrame(frameGrid);
				removeAttribute(frameGrid, 'gridSpacers');
				removeAttribute(frameGrid.parentNode, 'unHide');
			}
		}
	},
	
	// Remove "hover" status from every row in the grid
	clearHoverRows: function() {
		for(let hit of this.hoverHits) {
			hit.setHover(false);
		}
	},
	
	// Remove "current" status from every row in the grid
	clearCurrentRows: function() {
		for(let hit of this.currentHits) {
			hit.setCurrent(false);
		}
	},
	
	// This places the grid over the linked frame element
	placeGridOnFrame: function(grid) {
		var placement = grid.linkedFrame.frameElement.getClientRects()[0];
		if(!placement) { return; } // If for example the frame is invisible
		
		var frameStyle = getComputedStyle(grid.linkedFrame.frameElement);
		
		var top = placement.top +parseInt(frameStyle.borderTopWidth) +parseInt(frameStyle.paddingTop);
		var left = placement.left +parseInt(frameStyle.borderLeftWidth) +parseInt(frameStyle.paddingLeft);
		var width = placement.right
			-placement.left
			-parseInt(frameStyle.borderLeftWidth)
			-parseInt(frameStyle.paddingLeft)
			-parseInt(frameStyle.borderRightWidth)
			-parseInt(frameStyle.paddingRight);
		var height = placement.bottom
			-placement.top
			-parseInt(frameStyle.borderTopWidth)
			-parseInt(frameStyle.paddingTop)
			-parseInt(frameStyle.borderBottomWidth)
			-parseInt(frameStyle.paddingBottom);
		
		top += getDocProperty(grid.linkedFrame.ownerDocument, 'scrollTop');
		left += getDocProperty(grid.linkedFrame.ownerDocument, 'scrollLeft');
		
		// Frame content can be smaller than actual frame size
		// Note that the scrollbars size isn't taken into account here, so we ignore the width difference.
		// The real life examples where doing this may actually be detimental should be very reduced.
		//width = Math.min(width, getDocProperty(grid.linkedFrame.document, 'scrollWidth'));
		height = Math.min(height, getDocProperty(grid.linkedFrame.document, 'scrollHeight'));
		
		grid.parentNode.style.top = top+'px';
		grid.parentNode.style.left = left+'px';
		grid.parentNode.style.width = width+'px';
		grid.parentNode.style.height = height+'px';
		
		removeAttribute(grid.parentNode, 'beingPositioned');
	},
	
	// In case the frame element doesn't exist anymore for some reason, we remove it from the array.
	testFrameGrid: function(frameGrid) {
		try {
			frameGrid.linkedFrame.document.documentElement;
			return true;
		}
		catch(ex) {
			try { frameGrid.parentNode.remove(); }
			catch(exx) {}
			this.frames.delete(frameGrid);
			return false;
		}
	},
	
	setRepositionTags: function() {
		if(!documentHighlighted) { return false; } // there's no point in wasting cpu if it's going to be invisible
		
		var exist = false;
		for(let frameGrid of this.frames) {
			if(!this.testFrameGrid(frameGrid)) { continue; }
			
			setAttribute(frameGrid.parentNode, 'beingPositioned', 'true');
			exist = true;
		}
		
		return exist;
	},
	
	reposition: function() {
		if(!this.setRepositionTags()) { return; }
		
		for(let frameGrid of this.frames) {
			this.placeGridOnFrame(frameGrid);
		}
	},
	
	// Positions the grid on the right or on the left, accordingly to where the scrollbar should go in different locale layouts
	direction: function(doc) {
		// http://kb.mozillazine.org/Layout.scrollbar.side
		switch(Prefs['scrollbar.side']) {
			// Here's to hoping this one is actually correct as I have no way to test, I need to wait for some user input on this
			case 0:
				var rtlList = ['ar', 'he', 'fa', 'ps', 'ur'];
				var appLocale = Services.locale.getApplicationLocale().getCategory("NSILOCALE_MESSAGES");
				for(let locale of rtlList) {
					if(appLocale.startsWith(locale)) {
						return 'ltr';
					}
				}
				return 'rtl';
			
			case 1:
				if(doc.documentElement.dir == 'rtl') {
					return 'ltr';
				}
				return 'rtl';
			
			case 3:
				return 'ltr';
			
			case 2:
			default:
				return 'rtl';
		}
	},
	
	resizeSpacers: function(grid) {
		if(!grid) {
			this.resizeSpacers(this.chromeGrid);
			for(let frameGrid of this.frames) {
				this.resizeSpacers(frameGrid);
			}
			return;
		}
		
		let doc = (grid.linkedFrame) ? grid.linkedFrame.document : document;
		let scrollTopMax = getDocProperty(doc, 'scrollTopMax');
		let scrollLeftMax = getDocProperty(doc, 'scrollLeftMax');
		
		if(scrollTopMax == 0 && scrollLeftMax == 0) {
			setAttribute(grid, 'gridSpacers', 'none');
		} else if(scrollTopMax > 0 && scrollLeftMax > 0) {
			setAttribute(grid, 'gridSpacers', 'double');
		} else {
			setAttribute(grid, 'gridSpacers', 'single');
		}
	},
	
	removeAllGrids: function() {
		for(let frameGrid of this.frames) {
			try { frameGrid.parentNode.remove(); }
			catch(ex) {}
		}
		
		this.allHits = new Set();
		this.hoverHits = new Set();
		this.currentHits = new Set();
		this.frames = new Set();
		this._nextHit = 0;
	}
};

// the following constructors help mimic the chrome grid in here,
// so we have a single interface to work with in the methods above for both chrome (remote) and content (actual nodes) grid types

// control the actual hits and highlights and their status
this.GridHit = function(isRemote, rows, intoSelf) {
	this.i = grids._nextHit;
	grids._nextHit++;
	grids.allHits.add(this);
	
	this.isRemote = isRemote;
	this.rows = rows;
	
	if(intoSelf) {
		for(let prop in intoSelf) {
			this[prop] = intoSelf[prop];
		}
	}
	
	if(this.isRemote) {
		let data = {
			i: this.i,
			rows: []
		};
		for(let row of this.rows) {
			data.rows.push(row.i);
		}
		
		if(intoSelf) {
			for(let prop in intoSelf) {
				if(prop == 'range' || prop == 'editableNode') { continue; }
				data[prop] = intoSelf[prop];
			}
		}
		
		message('Grid:Hit:Create', data);
	}
};

this.GridHit.prototype = {
	setHover: function(isHover) {
		if(isHover) {
			grids.hoverHits.add(this);
		} else {
			grids.hoverHits.delete(this);
		}
		
		if(this.isRemote) {
			message('Grid:Hit:Hover', { i: this.i, isHover: isHover });
			return;
		}
		
		for(let row of this.rows) {
			try { toggleAttribute(row, 'hover', isHover); }
			catch(ex) {}
		}
	},
	
	setCurrent: function(isCurrent) {
		if(isCurrent) {
			grids.currentHits.add(this);
		} else {
			grids.currentHits.delete(this);
		}
		
		if(this.isRemote) {
			message('Grid:Hit:Current', { i: this.i, isCurrent: isCurrent });
			return;
		}
		
		for(let row of this.rows) {
			try { toggleAttribute(row, 'current', isCurrent); }
			catch(ex) {}
		}
	}
};

// control a pdf page's "hit"
this.GridPDFPage = function(pIdx, row, matches) {
	this.pIdx = pIdx;
	this.row = row;
	this.matches = matches;
	grids.pdfPageRows.set(pIdx, this);
};

this.GridPDFPage.prototype = {
	setHover: function(isHover) {
		if(isHover) {
			grids.hoverHits.add(this);
		} else {
			grids.hoverHits.delete(this);
		}
		
		try { toggleAttribute(this.row, 'hover', isHover); }
		catch(ex) {}
	},
	
	setCurrent: function(isCurrent) {
		if(isCurrent) {
			grids.currentHits.add(this);
		} else {
			grids.currentHits.delete(this);
		}
		
		try { toggleAttribute(this.row, 'current', isCurrent); }
		catch(ex) {}
	}
};

// to manage individual rows in the grid, either the actual nodes or remotely through messages
this.GridRow = function(aGrid, aNode) {
	this.i = aGrid.rows.length;
	aGrid.rows.push(this);
	
	this.highlight = null;
	this.grid = aGrid;
	this.node = aNode;
	
	if(this.node) {
		// this is the rows container
		this.grid._container.appendChild(this.node);
	}
	else {
		message('Grid:Row:Append', this.i);
	}
};

this.GridRow.prototype = {
	setAttribute: function(attr, val) {
		if(this.node) {
			this.node.setAttribute(attr, val);
			return;
		}
		
		message('Grid:Row:SetAttribute', { i: this.i, attr: attr, val: val });
	},
	
	removeAttribute: function(attr) {
		if(this.node) {
			this.node.removeAttribute(attr);
			return;
		}
		
		message('Grid:Row:RemoveAttribute', { i: this.i, attr: attr });
	},
	
	remove: function() {
		if(this.node) {
			this.node.remove();
			this.grid.rows.splice(this.i, 1);
			return;
		}
		
		message('Grid:Row:Remove', this.i);
	},
	
	style: function(prop, val) {
		if(this.node) {
			this.node.style[prop] = val;
			return;
		}
		
		message('Grid:Row:Style', { i: this.i, prop: prop, val: val });
	}
};
	
Modules.LOADMODULE = function() {
	Finder.buildHighlights.add('grid');
	Finder.addResultListener(grids);
	
	RemoteFinderListener.addMessage('Grid:Reposition', () => {
		grids.reposition();
	});
	
	RemoteFinderListener.addMessage('Grid:Remove', () => {
		grids.removeAllGrids();
	});
};

Modules.UNLOADMODULE = function() {
	Listeners.remove(Scope, 'resize', grids);
	
	RemoteFinderListener.removeMessage('Grid:Reposition');
	RemoteFinderListener.removeMessage('Grid:Remove');
	
	Finder.removeResultListener(grids);
	Finder.buildHighlights.delete('grid');
	
	grids.removeAllGrids();
	if(isPDFJS) {
		$('viewerContainer').removeEventListener('scroll', grids);
	}
};
